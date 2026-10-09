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
 * @param float|null $mbps
 *
 * @return string
 */
function statsFormatSpeed($mbps)
{
    if (null === $mbps) {
        return '-';
    }
    if ($mbps >= 1000) {
        return number_format($mbps / 1000, 2, '.', '').' Gbit/s';
    }
    $decimals = $mbps < 10 ? 2 : ($mbps < 100 ? 1 : 0);

    return number_format($mbps, $decimals, '.', '').' Mbit/s';
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
