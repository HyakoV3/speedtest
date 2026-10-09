<?php

/**
 * Monthly summary of the stored tests, for stats.php
 *
 * Pure functions: they get the rows and the settings, and do not open the database, so they can be tested without one.
 * The measurements are `text` in every schema and can hold anything ("", "Fail", junk), so they are cleaned here, in PHP:
 * a cast in SQL could abort the whole query on a single bad row. Percentiles are computed here too, because SQLite has no
 * percentile function and each of the other databases spells it differently.
 */

/**
 * The month asked for in the URL, or the current one (UTC) when it is missing or not a valid "YYYY-MM"
 *
 * @param mixed $input
 *
 * @return string
 */
function statsMonth($input)
{
    // \z rather than $, which would also accept a newline at the end
    if (is_string($input) && 1 === preg_match('/^\d{4}-(0[1-9]|1[0-2])\z/', $input)) {
        return $input;
    }

    return gmdate('Y-m');
}

/**
 * First day of the month and first day of the next one, in the form the database compares correctly
 *
 * SQLite compares the text of the column, which is "YYYY-MM-DD HH:MM:SS", so the bounds must have the same shape.
 * MSSQL reads "YYYY-MM-DD" as year-day-month under some languages; "YYYYMMDD" is read the same way under all of them.
 *
 * @param string $month  "YYYY-MM", already checked by statsMonth()
 * @param string $dbType
 *
 * @return array{0: string, 1: string}
 */
function statsMonthBounds($month, $dbType)
{
    $from = DateTimeImmutable::createFromFormat('!Y-m', $month, new DateTimeZone('UTC'));
    $to = $from->modify('first day of next month');
    $format = 'mssql' === $dbType ? 'Ymd' : 'Y-m-d';

    return [$from->format($format), $to->format($format)];
}

/**
 * A stored measurement as a number, or null when it is not one ("", "Fail", "12,5", negative, INF)
 *
 * @param mixed $value
 *
 * @return float|null
 */
function statsCleanValue($value)
{
    if (!is_string($value) && !is_int($value) && !is_float($value)) {
        return null;
    }
    $value = trim((string) $value);
    if (!is_numeric($value)) {
        return null;
    }
    $number = (float) $value;
    if (!is_finite($number) || $number < 0) {
        return null;
    }

    return $number;
}

/**
 * Nearest-rank percentile of a list sorted in ascending order: always one of the measured values
 *
 * @param float[] $sorted
 * @param int     $p      1 to 100
 *
 * @return float|null
 */
function statsPercentile(array $sorted, $p)
{
    $n = count($sorted);
    if (0 === $n) {
        return null;
    }
    // ceil(p * n / 100) in integers: with floats, 10 / 100 * 30 is 3.0000000000000004 and would round up to 4
    $rank = intdiv($p * $n + 99, 100);

    return $sorted[max(1, min($n, $rank)) - 1];
}

/**
 * Number of tests and, for each measurement, how many are usable and their P10, median and P90
 *
 * @param iterable $rows each with the keys dl, ul, ping and jitter (a PDOStatement in FETCH_ASSOC mode will do)
 *
 * @return array
 */
function statsSummarize($rows)
{
    $keys = ['dl', 'ul', 'ping', 'jitter'];
    $values = array_fill_keys($keys, []);
    $tests = 0;
    foreach ($rows as $row) {
        ++$tests;
        foreach ($keys as $key) {
            $value = statsCleanValue(isset($row[$key]) ? $row[$key] : null);
            if (null !== $value) {
                $values[$key][] = $value;
            }
        }
    }

    $summary = ['tests' => $tests];
    foreach ($keys as $key) {
        sort($values[$key], SORT_NUMERIC);
        $summary[$key] = [
            'count' => count($values[$key]),
            'p10' => statsPercentile($values[$key], 10),
            'p50' => statsPercentile($values[$key], 50),
            'p90' => statsPercentile($values[$key], 90),
        ];
        $values[$key] = null;
    }

    return $summary;
}

/**
 * Where the bar of a measurement starts, how wide it is and where the median is, as percentages of the P90
 *
 * Each measurement has its own scale (Mbit/s against ms), so the bar of a line only says how the P10 to P90 range
 * and the median sit against that line's own P90. It is null when there is nothing to draw.
 *
 * @param array $line one measurement of statsSummarize(): the keys p10, p50 and p90
 *
 * @return array{left: float, width: float, median: float}|null
 */
function statsBar(array $line)
{
    if (null === $line['p10'] || null === $line['p50'] || null === $line['p90'] || $line['p90'] <= 0) {
        return null;
    }
    $left = $line['p10'] / $line['p90'] * 100;

    return [
        'left' => round($left, 1),
        // A range that is a single value would be invisible
        'width' => round(max(1.0, 100 - $left), 1),
        'median' => round($line['p50'] / $line['p90'] * 100, 1),
    ];
}

/**
 * A speed as its number and its unit, so the page can set them apart: ["250", "Mbit/s"] or ["1.25", "Gbit/s"]
 *
 * @param float|null $mbps
 *
 * @return array{0: string, 1: string}|null
 */
function statsSpeedParts($mbps)
{
    if (null === $mbps) {
        return null;
    }
    if ($mbps >= 1000) {
        return [number_format($mbps / 1000, 2, '.', ''), 'Gbit/s'];
    }
    $decimals = $mbps < 10 ? 2 : ($mbps < 100 ? 1 : 0);

    return [number_format($mbps, $decimals, '.', ''), 'Mbit/s'];
}

/**
 * @param float|null $mbps
 *
 * @return string
 */
function statsFormatSpeed($mbps)
{
    $parts = statsSpeedParts($mbps);

    return null === $parts ? '-' : $parts[0].' '.$parts[1];
}

/**
 * @param float|null $ms
 *
 * @return string
 */
function statsFormatMs($ms)
{
    return null === $ms ? '-' : number_format($ms, 1, '.', '').' ms';
}

/** How many tests a page of the list can have */
const STATS_PER_PAGE_CHOICES = [25, 50, 100, 250, 500, 1000];

/**
 * The size of a page asked for in the URL, or 50 when it is missing or not one of the choices
 *
 * @param mixed $input
 *
 * @return int
 */
function statsPerPage($input)
{
    if (is_string($input) && ctype_digit($input) && in_array((int) $input, STATS_PER_PAGE_CHOICES, true)) {
        return (int) $input;
    }

    return 50;
}

/**
 * How many pages $total tests make, at least one
 *
 * @param int $total
 * @param int $perPage
 *
 * @return int
 */
function statsPageCount($total, $perPage)
{
    return max(1, intdiv(max(0, $total) + $perPage - 1, $perPage));
}

/**
 * The page asked for in the URL, kept between the first and the last
 *
 * @param mixed $input
 * @param int   $total
 * @param int   $perPage
 *
 * @return int
 */
function statsPageNumber($input, $total, $perPage)
{
    $page = is_string($input) && ctype_digit($input) ? (int) $input : 1;

    return max(1, min(statsPageCount($total, $perPage), $page));
}

/**
 * The ISP of a test as text, without the IP address it starts with: the stored value is JSON with the text in
 * "processedString"
 *
 * @param mixed $ispinfo
 *
 * @return string
 */
function statsIspText($ispinfo)
{
    if (!is_string($ispinfo)) {
        return '';
    }
    $decoded = json_decode($ispinfo, true);
    if (is_array($decoded) && isset($decoded['processedString']) && is_string($decoded['processedString'])) {
        $text = $decoded['processedString'];
        // It starts with the IP address, which the list shows on its own: "203.0.113.7 - ACME Net, Brazil"
        $dash = strpos($text, ' - ');

        return false === $dash ? $text : substr($text, $dash + 3);
    }

    return $ispinfo;
}

/**
 * The links to the other pages of the list, as HTML: First and Previous, where the person is, Next and Last
 *
 * @param int    $page
 * @param int    $pages
 * @param int    $perPage
 * @param string $month  "YYYY-MM", kept so the summary does not change when the page does
 * @param int    $total
 * @param string $label  what a screen reader says for this group of links
 *
 * @return string
 */
function statsPager($page, $pages, $perPage, $month, $total, $label = 'Pages of tests')
{
    $link = function ($target, $label) use ($perPage, $month) {
        $query = http_build_query(['month' => $month, 'per' => $perPage, 'page' => $target]);

        return '<a href="stats.php?'.htmlspecialchars($query, ENT_QUOTES | ENT_HTML5, 'UTF-8').'">'.$label.'</a>';
    };
    $off = function ($label) {
        return '<span class="off" aria-disabled="true">'.$label.'</span>';
    };

    return '<nav class="pager" aria-label="'.htmlspecialchars($label, ENT_QUOTES | ENT_HTML5, 'UTF-8').'">'
        .($page > 1 ? $link(1, 'First').$link($page - 1, 'Previous') : $off('First').$off('Previous'))
        .'<span aria-current="page">Page '.(int) $page.' of '.(int) $pages.' ('.(int) $total.' tests)</span>'
        .($page < $pages ? $link($page + 1, 'Next').$link($pages, 'Last') : $off('Next').$off('Last'))
        .'</nav>';
}

/** Under this many usable values the percentiles of a measurement are rough, and the page says so */
const STATS_FEW_SAMPLES = 10;

/**
 * The month that comes $delta months after (or before, when negative) $month
 *
 * @param string $month "YYYY-MM", already checked by statsMonth()
 * @param int    $delta
 *
 * @return string
 */
function statsMonthShift($month, $delta)
{
    $first = DateTimeImmutable::createFromFormat('!Y-m', $month, new DateTimeZone('UTC'));

    return $first->modify(sprintf('%+d month', $delta))->format('Y-m');
}

/**
 * "October 2026", for a person to read
 *
 * @param string $month "YYYY-MM", already checked by statsMonth()
 *
 * @return string
 */
function statsMonthLabel($month)
{
    return DateTimeImmutable::createFromFormat('!Y-m', $month, new DateTimeZone('UTC'))->format('F Y');
}

/**
 * A stored measurement as it goes in a cell of the list: the number in Mbit/s (or in ms), or the text that was stored
 * when it is not a number ("Fail"), or "-" when there is nothing
 *
 * @param mixed $raw
 * @param bool  $speed true for a speed (no decimals from 100 up), false for a time in ms
 *
 * @return string
 */
function statsCell($raw, $speed)
{
    $value = statsCleanValue($raw);
    if (null === $value) {
        $text = is_string($raw) ? trim($raw) : '';

        return '' === $text ? '-' : $text;
    }
    if (!$speed) {
        return number_format($value, 1, '.', '');
    }

    return number_format($value, $value < 10 ? 2 : ($value < 100 ? 1 : 0), '.', '');
}
