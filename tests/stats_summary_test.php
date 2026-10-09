<?php
// Tests of results/stats_summary.php, in plain PHP (the repository has no PHP test framework):
//     php tests/stats_summary_test.php
require_once __DIR__.'/../results/stats_summary.php';

$failures = 0;
function check($expected, $actual, $what)
{
    global $failures;
    if ($expected !== $actual) {
        ++$failures;
        fwrite(STDERR, 'FAIL '.$what.': expected '.var_export($expected, true).', got '.var_export($actual, true)."\n");
    }
}

check('2026-02', statsMonth('2026-02'), 'a valid month');
check(gmdate('Y-m'), statsMonth('2026-13'), 'month 13');
check(gmdate('Y-m'), statsMonth('2026-00'), 'month 0');
check(gmdate('Y-m'), statsMonth("2026-02\n"), 'a newline at the end');
check(gmdate('Y-m'), statsMonth(['2026-02']), 'an array');
check(gmdate('Y-m'), statsMonth(null), 'missing');

check(['2026-12-01', '2027-01-01'], statsMonthBounds('2026-12', 'sqlite'), 'December');
check(['2028-02-01', '2028-03-01'], statsMonthBounds('2028-02', 'postgresql'), 'February of a leap year');
check(['20261001', '20261101'], statsMonthBounds('2026-10', 'mssql'), 'MSSQL form');

check(12.5, statsCleanValue('12.5'), 'decimal');
check(12.5, statsCleanValue(' 12.5 '), 'spaces');
check(0.0, statsCleanValue('0'), 'zero is a value');
check(1000.0, statsCleanValue('1e3'), 'exponent');
check(null, statsCleanValue(''), 'empty');
check(null, statsCleanValue(null), 'null');
check(null, statsCleanValue('Fail'), 'Fail');
check(null, statsCleanValue('12,5'), 'decimal comma');
check(null, statsCleanValue('-3'), 'negative');
check(null, statsCleanValue('1e999'), 'infinite');
check(null, statsCleanValue('NaN'), 'NaN');

$list = range(1, 30);
check(3, statsPercentile($list, 10), 'P10 of 1..30 (float trap)');
check(15, statsPercentile($list, 50), 'P50 of 1..30');
check(27, statsPercentile($list, 90), 'P90 of 1..30');
check(7.0, statsPercentile([7.0], 10), 'one value');
check(null, statsPercentile([], 50), 'no value');
check(1, statsPercentile([1, 2], 50), 'nearest rank takes the lower of two');

$rows = [
    ['dl' => '100', 'ul' => '10', 'ping' => '20', 'jitter' => '1'],
    ['dl' => '', 'ul' => 'Fail', 'ping' => '30', 'jitter' => '2'],
    ['dl' => '300', 'ul' => '30', 'ping' => 'Fail', 'jitter' => ''],
    ['dl' => '200', 'ul' => '20', 'ping' => '10', 'jitter' => '3'],
];
$s = statsSummarize($rows);
check(4, $s['tests'], 'tests');
check(3, $s['dl']['count'], 'usable downloads');
check(200.0, $s['dl']['p50'], 'median download');
check(300.0, $s['dl']['p90'], 'P90 download');
check(3, $s['ul']['count'], 'usable uploads');
check(3, $s['ping']['count'], 'usable pings');
check(10.0, $s['ping']['p10'], 'P10 ping');
check(['count' => 0, 'p10' => null, 'p50' => null, 'p90' => null], statsSummarize([])['dl'], 'empty month');

check(null, statsBar(['p10' => null, 'p50' => null, 'p90' => null]), 'no bar without values');
check(null, statsBar(['p10' => 0.0, 'p50' => 0.0, 'p90' => 0.0]), 'no bar when everything is zero');
check(['left' => 10.0, 'width' => 90.0, 'median' => 50.0], statsBar(['p10' => 10.0, 'p50' => 50.0, 'p90' => 100.0]), 'a bar');
check(['left' => 100.0, 'width' => 1.0, 'median' => 100.0], statsBar(['p10' => 7.0, 'p50' => 7.0, 'p90' => 7.0]), 'one value is still visible');

check('-', statsFormatSpeed(null), 'no value');
check('5.25 Mbit/s', statsFormatSpeed(5.25), 'below 10');
check('52.5 Mbit/s', statsFormatSpeed(52.5), 'below 100');
check('525 Mbit/s', statsFormatSpeed(525.4), 'below 1000');
check('1.25 Gbit/s', statsFormatSpeed(1250.0), 'Gbit/s');
check('12.3 ms', statsFormatMs(12.34), 'ms');

check(50, statsPerPage(null), 'page size missing');
check(50, statsPerPage('30'), 'page size not offered');
check(50, statsPerPage(['25']), 'page size as array');
check(25, statsPerPage('25'), '25 a page');
check(250, statsPerPage('250'), '250 a page');
check(1000, statsPerPage('1000'), '1000 a page');
check(50, statsPerPage('200'), '200 is no longer offered');
check(50, statsPerPage('2000'), 'more than the largest');
check(50, statsPerPage('25 '), 'page size with a space');
check(1, statsPageCount(0, 50), 'no tests, one page');
check(1, statsPageCount(50, 50), 'exactly one page');
check(2, statsPageCount(51, 50), 'one more than a page');
check(40, statsPageCount(1000, 25), 'a thousand tests');
check(1, statsPageNumber(null, 100, 25), 'page missing');
check(1, statsPageNumber('0', 100, 25), 'page zero');
check(1, statsPageNumber('-3', 100, 25), 'page negative');
check(3, statsPageNumber('3', 100, 25), 'page 3');
check(4, statsPageNumber('99', 100, 25), 'page after the last');
check(1, statsPageNumber('99999999999999999999', 0, 25), 'huge page with no tests');
check('ACME Net, Brazil', statsIspText('{"processedString":"ACME Net, Brazil"}'), 'ISP from JSON');
check('ACME Net, Brazil', statsIspText('{"processedString":"203.0.113.7 - ACME Net, Brazil"}'), 'ISP without the IP');
check('ACME - Net, Brazil', statsIspText('{"processedString":"203.0.113.7 - ACME - Net, Brazil"}'), 'only the first dash is the IP');
check('not json', statsIspText('not json'), 'ISP that is not JSON');
check('', statsIspText(null), 'ISP missing');
$pagerFirst = statsPager(1, 3, 50, '2026-10', 120);
check(true, false !== strpos($pagerFirst, 'Page 1 of 3 (120 tests)'), 'pager says where it is');
check(2, substr_count($pagerFirst, '<a href='), 'pager on the first page has Next and Last');
check(2, substr_count($pagerFirst, 'class="off"'), 'pager on the first page disables First and Previous');
check(true, false !== strpos($pagerFirst, 'month=2026-10&amp;per=50&amp;page=2'), 'pager keeps the month and the size');
check(4, substr_count(statsPager(2, 3, 50, '2026-10', 120), '<a href='), 'pager in the middle has four links');
check(2, substr_count(statsPager(3, 3, 50, '2026-10', 120), '<a href='), 'pager on the last page has First and Previous');

check(['250', 'Mbit/s'], statsSpeedParts(250.0), 'speed parts in Mbit/s');
check(['1.25', 'Gbit/s'], statsSpeedParts(1250.0), 'speed parts in Gbit/s');
check(null, statsSpeedParts(null), 'speed parts without a value');
check('2026-11', statsMonthShift('2026-10', 1), 'next month');
check('2026-09', statsMonthShift('2026-10', -1), 'previous month');
check('2027-01', statsMonthShift('2026-12', 1), 'January after December');
check('2025-12', statsMonthShift('2026-01', -1), 'December before January');
check('2026-03', statsMonthShift('2026-01', 2), 'two months on');
check('October 2026', statsMonthLabel('2026-10'), 'month label');
check('February 2028', statsMonthLabel('2028-02'), 'month label of a leap year');
check('328', statsCell('328.4', true), 'speed cell above 100');
check('52.5', statsCell('52.5', true), 'speed cell below 100');
check('5.25', statsCell('5.25', true), 'speed cell below 10');
check('12.3', statsCell('12.34', false), 'time cell');
check('Fail', statsCell('Fail', true), 'a failed measurement shows its text');
check('-', statsCell('', true), 'an empty measurement');
check('-', statsCell(null, false), 'a missing measurement');
check(true, false !== strpos(statsPager(1, 3, 50, '2026-10', 120, 'Top "pages"'), 'aria-label="Top &quot;pages&quot;"'), 'pager label is escaped');

echo 0 === $failures ? "OK\n" : $failures." failures\n";
exit($failures > 0 ? 1 : 0);
