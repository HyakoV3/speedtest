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

check('-', statsFormatSpeed(null), 'no value');
check('5.25 Mbit/s', statsFormatSpeed(5.25), 'below 10');
check('52.5 Mbit/s', statsFormatSpeed(52.5), 'below 100');
check('525 Mbit/s', statsFormatSpeed(525.4), 'below 1000');
check('1.25 Gbit/s', statsFormatSpeed(1250.0), 'Gbit/s');
check('12.3 ms', statsFormatMs(12.34), 'ms');

echo 0 === $failures ? "OK\n" : $failures." failures\n";
exit($failures > 0 ? 1 : 0);
