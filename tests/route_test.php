<?php
// Tests of backend/route_util.php, in plain PHP (the repository has no PHP test framework):
//     docker run --rm -v "$PWD":/app -w /app php:8-apache php tests/route_test.php
require_once __DIR__.'/../backend/route_util.php';

$failures = 0;
function check($expected, $actual, $what)
{
    global $failures;
    if ($expected !== $actual) {
        ++$failures;
        fwrite(STDERR, 'FAIL '.$what.': expected '.var_export($expected, true).', got '.var_export($actual, true)."\n");
    }
}

function fixture($name)
{
    return file_get_contents(__DIR__.'/fixtures/route/'.$name.'.txt');
}

// routeIpInCidr and routeParseCidrList
check(true, routeIpInCidr('172.18.0.5', '172.16.0.0/12'), 'in a /12');
check(false, routeIpInCidr('172.32.0.1', '172.16.0.0/12'), 'out of a /12');
check(true, routeIpInCidr('10.0.0.1', '10.0.0.1'), 'a single address');
check(false, routeIpInCidr('10.0.0.2', '10.0.0.1'), 'another single address');
check(true, routeIpInCidr('fd00::5', 'fd00::/8'), 'IPv6 in a /8');
check(false, routeIpInCidr('8.8.8.8', 'fd00::/8'), 'IPv4 against an IPv6 range');
check(false, routeIpInCidr('8.8.8.8', '8.8.8.0/33'), 'a prefix that is too long');
check(false, routeIpInCidr('8.8.8.8', 'nonsense'), 'an invalid range');
check(['10.0.0.1', '172.16.0.0/12'], routeParseCidrList('10.0.0.1, 172.16.0.0/12'), 'a list');
check(['10.0.0.1'], routeParseCidrList('10.0.0.1, nonsense, 1.2.3.4/99'), 'invalid items are left out');
check([], routeParseCidrList(''), 'an empty list');

// routePmtu (the container of the Frigga demo has an MTU of 65520 and shows no F=)
check(['pmtu' => null, 'drops' => []], routePmtu(routeParse(fixture('frigga-no-f'))), 'no F= is an unknown MTU');
check(['pmtu' => null, 'drops' => []], routePmtu(routeParse(" 1  10.0.0.1  1 ms F=65520\n")), 'F=65520 is an unknown MTU');
check(
    ['pmtu' => 1480, 'drops' => [['ttl' => 3, 'from' => 1500, 'to' => 1480]]],
    routePmtu(routeParse(fixture('mtu-q1-1.1.1.1'))),
    'the MTU drops from 1500 to 1480 at the hop 3'
);
check(['pmtu' => 1500, 'drops' => []], routePmtu(routeParse(fixture('hairpin'))), 'a path that does not drop');
check(['pmtu' => null, 'drops' => []], routePmtu([]), 'an empty list');

// routeClientIp
$proxy = ['172.16.0.0/12'];
check('203.0.113.5', routeClientIp(['REMOTE_ADDR' => '203.0.113.5', 'HTTP_X_FORWARDED_FOR' => '8.8.8.8'], []), 'XFF without a trusted proxy');
check(
    '203.0.113.5',
    routeClientIp(
        ['REMOTE_ADDR' => '203.0.113.5', 'HTTP_CLIENT_IP' => '8.8.8.8', 'HTTP_X_REAL_IP' => '8.8.4.4', 'HTTP_CF_CONNECTING_IPV6' => '2606:4700::1111'],
        []
    ),
    'Client-IP, X-Real-IP and the others are not read'
);
check('198.51.100.20', routeClientIp(['REMOTE_ADDR' => '172.18.0.1', 'HTTP_X_FORWARDED_FOR' => '6.6.6.6, 198.51.100.20'], $proxy), 'the right-most address');
check('198.51.100.20', routeClientIp(['REMOTE_ADDR' => '172.18.0.1', 'HTTP_X_FORWARDED_FOR' => '198.51.100.20, 172.18.0.5'], $proxy), 'trusted proxies at the end are skipped');
check(false, routeClientIp(['REMOTE_ADDR' => '172.18.0.1'], $proxy), 'a trusted proxy without XFF');
check(false, routeClientIp(['REMOTE_ADDR' => '172.18.0.1', 'HTTP_X_FORWARDED_FOR' => 'lixo'], $proxy), 'a junk XFF');
check('198.51.100.20', routeClientIp(['REMOTE_ADDR' => '172.18.0.1', 'HTTP_X_FORWARDED_FOR' => '::ffff:198.51.100.20'], $proxy), 'a mapped IPv4 address');
check(false, routeClientIp([], []), 'no REMOTE_ADDR');
check(false, routeClientIp(['REMOTE_ADDR' => 'junk'], []), 'an invalid REMOTE_ADDR');

// routeTargetError
check(null, routeTargetError('8.8.8.8', false), 'a public address');
foreach (['10.0.0.1', '172.16.0.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '100.127.255.255', '192.0.2.1', '198.18.0.1', '224.0.0.1', '239.255.255.250', '255.255.255.255', '0.0.0.0', '240.0.0.1'] as $address) {
    check('not_global', routeTargetError($address, false), 'not global: '.$address);
}
check(null, routeTargetError('100.128.0.1', false), 'just after the CGNAT range');
check('ipv6', routeTargetError('2606:4700::1111', false), 'IPv6 when it is not allowed');
check(null, routeTargetError('2606:4700::1111', true), 'IPv6 when it is allowed');
check('not_global', routeTargetError('ff02::1', true), 'IPv6 multicast');
foreach (['', '8.8.8.8 ', '8.8.8.8;id', '-n', '$(id)', ['8.8.8.8']] as $value) {
    check('invalid', routeTargetError($value, true), 'invalid: '.json_encode($value));
}

// IPv6: targets that are not global (several of them carry an IPv4 address, which could be a private one), and the parse of a route
foreach (['fe80::1', 'fd00::1', 'ff02::1', '2001:db8::1', '64:ff9b::1.2.3.4', '::ffff:10.0.0.1', '2002:a00:1::1', 'fec0::1', '::1', '::'] as $address) {
    check('not_global', routeTargetError($address, true), 'not global (IPv6): '.$address);
}
check(null, routeTargetError('2606:4700:4700::1111', true), 'a global IPv6 address');
check('ipv6', routeTargetError('fe80::1', false), 'IPv6 is told first when it is not allowed');
check('private', routeHopScope('fe80::1'), 'scope of a link-local address');
check('private', routeHopScope('fd00::1'), 'scope of a ULA address');
check('public', routeHopScope('2606:4700:4700::1111'), 'scope of a global IPv6 address');
$v6 = routeParse(fixture('frigga-v6'));
check(8, count($v6), 'hops of frigga-v6');
check('2400:cb00:1292:3::', key($v6[6]['ips']), 'an address that ends in ::');
check(['-6'], array_slice(routeCommands('/usr/bin/traceroute', '2606:4700:4700::1111', 6)['mtu'], 1, 1), 'the -6 option of the mtu command');
check('2606:4700:4700::1111', end(routeCommands('/usr/bin/traceroute', '2606:4700:4700::1111', 6)['quick']), 'the IPv6 target is the last argument');
check('2606:4700:4700::1111', routeClientIp(['REMOTE_ADDR' => '72.21.17.84', 'HTTP_X_FORWARDED_FOR' => '2606:4700:4700::1111'], ['72.21.17.84']), 'an IPv6 visitor behind an IPv4 proxy');
check(true, routeIpInCidr('2606:4700:4700::1111', '2606:4700::/32'), 'an IPv6 address in an IPv6 range');
$summary = routeSummarize($v6, []);
check(8, count($summary), 'the IPv6 summary');
check('public', $summary[7]['scope'], 'the last IPv6 hop is public');
check(['pmtu' => null, 'drops' => []], routePmtu($v6), 'no F= in the IPv6 route');

// routeHopScope
check('none', routeHopScope(null), 'scope none');
check('cgnat', routeHopScope('100.65.61.62'), 'scope cgnat');
check('private', routeHopScope('192.168.0.1'), 'scope private');
check('public', routeHopScope('1.1.1.1'), 'scope public');

// routeCommands: the address is the last argument, and an invalid one gives no command
check(
    [
        'quick' => ['/usr/bin/traceroute', '-n', '-q', '3', '-w', '1', '-m', '20', '8.8.8.8'],
        'mtu' => ['/usr/bin/traceroute', '-n', '--mtu', '-q', '1', '-w', '1', '-m', '20', '8.8.8.8'],
    ],
    routeCommands('/usr/bin/traceroute', '8.8.8.8', 4),
    'the commands'
);
check('8.8.8.8', end(routeCommands('/usr/bin/traceroute', '8.8.8.8', 4)['quick']), 'the address is the last argument');
check(null, routeCommands('/usr/bin/traceroute', '8.8.8.8;id', 4), 'an address with a command in it');
check('-6', routeCommands('/usr/bin/traceroute', '2606:4700::1111', 6)['quick'][1], 'the IPv6 option');

// routeParse
$q = routeParse(fixture('udp-q3-1.1.1.1'));
check(12, count($q), 'hops of udp-q3-1.1.1.1');
$q = routeParse(fixture('udp-q3-8.8.8.8'));
check(3, count($q[8]['ips']), 'the hop 9 has 3 routers');
check(3, $q[11]['lost'], 'the hop 12 has no answer');
$m = routeParse(fixture('mtu-q1-1.1.1.1'));
check([1500, 1480], [$m[0]['mtu'], $m[2]['mtu']], 'F= at the hops 1 and 3');
$f = routeParse(fixture('flags'));
check(['!H'], $f[0]['flags'], 'a !H flag');
check(['!X'], $f[1]['flags'], 'a !X flag');
check([1, 2, 4], array_map(function ($hop) {
    return $hop['ttl'];
}, $f), 'the hop with an invalid address and the junk line are out');
check([], routeParse(null), 'not a string');

// routeSummarize
$s = routeSummarize(routeParse(fixture('udp-q3-silent-tail')), routeParse(fixture('mtu-q1-silent-tail')));
check(9, end($s)['ttl'], 'the silent end is out');
check('none', $s[1]['scope'], 'a silent hop in the middle stays');
$s = routeSummarize(routeParse(fixture('udp-q3-8.8.8.8')), routeParse(fixture('mtu-q1-8.8.8.8')));
check(2, count($s[8]['alt_ips']), 'ECMP: alt_ips');
check(true, in_array($s[8]['ip'], ['100.64.10.88', '100.64.10.51', '100.64.10.59'], true), 'ECMP: the ip is one of them');
check(3, $s[0]['answered'], 'the times come from the quick list');
check(0.21, $s[0]['rtt_min'], 'rtt_min of the first hop is the quick one (3 times, not the single one of mtu)');
check(0, $s[11]['answered'], 'the hop 12 has no answers');
check('none', $s[11]['scope'], 'the hop 12 is none');
$s = routeSummarize([], routeParse(fixture('mtu-q1-1.1.1.1')));
check(12, count($s), 'the mtu list is the reserve');

// routeCliUrl: the address that the page may offer to get librespeed-route from
check('https://github.com/HyakoV3/librespeed-route/releases', routeCliUrl('https://github.com/HyakoV3/librespeed-route/releases'), 'a releases page');
check('https://example.org', routeCliUrl('https://example.org'), 'a host alone');
check('https://example.org:8443/a/b-c_d.e~f%20g+h', routeCliUrl('https://example.org:8443/a/b-c_d.e~f%20g+h'), 'a port and a path');
foreach (['', 'http://example.org/x', 'javascript:alert(1)', 'https://user@example.org/', 'https://user:pass@example.org/', 'https://example.org/?a=b',
    'https://example.org/#top', "https://example.org/x'y", 'https://example.org/x"y', 'https://example.org/x y', "https://example.org/x\n",
    'https://example.org/x<y', 'https://', 'https:///x', 'ftp://example.org', 'HTTPS://example.org', '//example.org', 'https://exa mple.org',
    'https://example.org:99999999/', str_repeat('a', 201), 'https://example.org/'.str_repeat('a', 200)] as $bad) {
    check(null, routeCliUrl($bad), 'not offered: '.substr(var_export($bad, true), 0, 40));
}
check(null, routeCliUrl(null), 'null is not offered');
check(null, routeCliUrl(['https://example.org']), 'an array is not offered');
check(null, routeCliUrl(42), 'a number is not offered');
check('https://example.org/'.str_repeat('a', 180), routeCliUrl('https://example.org/'.str_repeat('a', 180)), 'an address of exactly 200 characters is offered');

// routeEnrich
$lookup = function ($ip) {
    $data = [
        '8.8.8.8' => ['asn' => 'AS15169', 'as_name' => 'Google LLC', 'country' => 'US', 'continent' => 'NA'],
        '1.1.1.1' => ['asn' => 'AS13335', 'as_name' => 'Cloudflare', 'country' => 'AU', 'continent' => 'OC'],
        '9.9.9.9' => ['asn' => '', 'as_name' => '', 'country' => 'BR', 'continent' => 'SA'],
        '4.4.4.4' => ['asn' => 'AS3356', 'as_name' => 'Level 3', 'country' => 'US', 'continent' => 'NA'],
    ];

    return isset($data[$ip]) ? $data[$ip] : null;
};
$hop = function ($ttl, $ip, $rtt) {
    return ['ttl' => $ttl, 'ip' => $ip, 'alt_ips' => [], 'rtt_min' => $rtt, 'rtt_avg' => $rtt, 'sent' => 3, 'answered' => $rtt ? 3 : 0, 'flags' => [], 'scope' => routeHopScope($ip)];
};
$e = routeEnrich([$hop(1, '192.168.0.1', 0.5), $hop(2, '9.9.9.9', 3.0), $hop(3, '1.1.1.1', 16.0), $hop(4, '4.4.4.4', 120.0), $hop(5, null, null)], $lookup);
check(false, isset($e[0]['asn']), 'a private hop has no network');
check(null, $e[1]['asn'], 'an empty asn is null');
check('SA', $e[1]['continent'], 'the first public hop is the anchor');
check(true, $e[2]['country_doubt'], 'OC at 16 ms after SA is doubtful');
check(false, $e[3]['country_doubt'], 'NA at 120 ms is not doubtful');
check(false, isset($e[4]['asn']), 'a silent hop has no network');
$real = backend_mmdb_lookup('8.8.8.8');
check('AS15169', $real['asn'], 'the real database knows 8.8.8.8');

function backend_mmdb_lookup($ip)
{
    require_once __DIR__.'/../backend/geoip2.phar';
    $reader = new MaxMind\Db\Reader(__DIR__.'/../backend/country_asn.mmdb');

    return $reader->get($ip);
}

// routeTargetCountry
check('BR', routeTargetCountry(['country' => 'BR', 'asn' => 'AS1']), 'the country of the visitor');
check(null, routeTargetCountry(null), 'no answer from the database');
check(null, routeTargetCountry(['country' => '']), 'an empty country');
check(null, routeTargetCountry(['country' => 'br']), 'not two capital letters');
check(null, routeTargetCountry(['country' => '<b>']), 'junk');
check(null, routeTargetCountry(['country' => "US\n"]), 'a newline at the end');
check('US', routeTargetCountry(backend_mmdb_lookup('8.8.8.8')), 'the real database gives US for 8.8.8.8');

// routeAdmit and routeAcquireSlot, in a temporary folder
$dir = sys_get_temp_dir().'/route-test-'.bin2hex(random_bytes(4));
mkdir($dir, 0700);
$now = 1000000;
check(null, routeAdmit($dir, 'aa11', $now, 60, 60), 'the first route is let in');
check(['rate_client', 60], routeAdmit($dir, 'aa11', $now, 60, 60), 'the second one in the same second waits');
check(null, routeAdmit($dir, 'aa11', $now + 61, 60, 60), 'a minute later it is let in again');
$dir2 = sys_get_temp_dir().'/route-test-'.bin2hex(random_bytes(4));
mkdir($dir2, 0700);
for ($i = 0; $i < 60; ++$i) {
    check(null, routeAdmit($dir2, sprintf('%02x', $i), $now, 60, 60), 'route '.$i.' of the hour');
}
$denied = routeAdmit($dir2, 'ff', $now, 60, 60);
check('rate_server', $denied[0], 'the 61st route of the hour');
$a = routeAcquireSlot($dir, 2);
$b = routeAcquireSlot($dir, 2);
check(false, routeAcquireSlot($dir, 2), 'the third place is not there');
fclose($a);
$again = routeAcquireSlot($dir, 2);
check(true, is_resource($again), 'a place is free after fclose');
fclose($again);
fclose($b);

// routeBegin: a route that does not run uses nothing up
$dir3 = sys_get_temp_dir().'/route-test-'.bin2hex(random_bytes(4));
mkdir($dir3, 0700);
$yes = function () {
    return true;
};
$no = function () {
    return false;
};
$files = function ($folder) {
    return array_values(array_diff(scandir($folder), ['.', '..', 'state.lock', 'slot-0.lock', 'slot-1.lock']));
};
// All the places are taken: "busy", and nothing of the visitor or of the hour is written down
$p0 = routeAcquireSlot($dir3, 2);
$p1 = routeAcquireSlot($dir3, 2);
check(['busy', 15, null], routeBegin($dir3, 'bb22', $now, 60, 60, 2, $yes), 'no place: busy');
check([], $files($dir3), 'a busy answer writes nothing down (no file of the visitor, no hourly.json)');
fclose($p0);
fclose($p1);
// The tool is missing: 503, nothing written down, and the place is free again
check(['tool_missing', null, null], routeBegin($dir3, 'bb22', $now, 60, 60, 2, $no), 'no traceroute');
check([], $files($dir3), 'a tool_missing answer writes nothing down');
$q0 = routeAcquireSlot($dir3, 2);
$q1 = routeAcquireSlot($dir3, 2);
check(true, is_resource($q0) && is_resource($q1), 'the places are free after a tool_missing answer');
fclose($q0);
fclose($q1);
// A route that starts is written down, and keeps its place
$started = routeBegin($dir3, 'bb22', $now, 60, 60, 2, $yes);
check([null, null], [$started[0], $started[1]], 'a route starts');
check(true, is_resource($started[2]), 'with a place');
check(['hourly.json', 'rl-bb22'], $files($dir3), 'and it is written down');
// The same visitor again: refused by the limit, and the place goes back
$again = routeBegin($dir3, 'bb22', $now, 60, 60, 2, $yes);
check(['rate_client', 60, null], $again, 'the same visitor has to wait');
$spare = routeAcquireSlot($dir3, 2);
check(true, is_resource($spare), 'a refusal by the limit gives the place back');
fclose($spare);
fclose($started[2]);
// A busy answer does not use up the minute of the visitor: the next try, with a place, is let in
$dir4 = sys_get_temp_dir().'/route-test-'.bin2hex(random_bytes(4));
mkdir($dir4, 0700);
$h0 = routeAcquireSlot($dir4, 1);
check('busy', routeBegin($dir4, 'cc33', $now, 60, 60, 1, $yes)[0], 'busy once');
fclose($h0);
$retry = routeBegin($dir4, 'cc33', $now + 15, 60, 60, 1, $yes);
check(null, $retry[0], 'the retry after the 15 seconds that were told is let in');
fclose($retry[2]);
array_map('unlink', glob($dir3.'/*') ?: []);
array_map('unlink', glob($dir4.'/*') ?: []);
rmdir($dir3);
rmdir($dir4);
check(32, strlen(routeClientKey($dir, '203.0.113.5')), 'the key has 32 characters');
check(routeClientKey($dir, '203.0.113.5'), routeClientKey($dir, '203.0.113.5'), 'the key is stable');
check(true, routeClientKey($dir, '203.0.113.5') !== routeClientKey($dir, '203.0.113.6'), 'the key tells visitors apart');
check(false, false !== strpos(implode(' ', scandir($dir)), '203.0.113'), 'no address in the names of the files');
array_map('unlink', glob($dir.'/*') ?: []);
array_map('unlink', glob($dir2.'/*') ?: []);
rmdir($dir);
rmdir($dir2);

// routeRun, with no network
$t = microtime(true);
$r = routeRun(['s' => ['/bin/sleep', '5']], microtime(true) + 1, 16384, []);
check('deadline', $r['s']['stopped'], 'the deadline stops a command');
check(true, microtime(true) - $t < 2.5, 'and it does not wait more than the deadline');
$r = routeRun(['y' => ['/usr/bin/yes']], microtime(true) + 5, 16384, []);
check('size', $r['y']['stopped'], 'the size limit stops a command');
check(true, strlen($r['y']['out']) <= 16384, 'and the output is cut');
$r = routeRun(['p' => ['/usr/bin/printf', " 1  *\n 2  *\n 3  *\n 4  *\n 5  1.1.1.1  1 ms\n"]], microtime(true) + 5, 16384, ['p' => 4]);
check('silent', $r['p']['stopped'], '4 hops in a row with no answer stop a command');
$r = routeRun(['p' => ['/usr/bin/printf', " 1  *\n 2  1.1.1.1  1 ms\n"]], microtime(true) + 5, 16384, ['p' => 4]);
check('eof', $r['p']['stopped'], 'a command that ends by itself');

// The error output is read only when it is asked for (the version of traceroute is written there)
$r = routeRun(['e' => ['/bin/sh', '-c', 'echo out; echo err >&2']], microtime(true) + 5, 16384, []);
check("out\n", $r['e']['out'], 'the error output is not read by default');
$r = routeRun(['e' => ['/bin/sh', '-c', 'echo out; echo err >&2']], microtime(true) + 5, 16384, [], true);
check(true, false !== strpos($r['e']['out'], 'err'), 'the error output is read when it is asked for');

// routeEnrichInput: the body of route_enrich.php is checked, and anything that is not exactly what is expected is refused
$body = function (array $change = []) {
    return json_encode(array_merge(['v' => 1, 'target' => '8.8.8.8', 'hops' => [['ttl' => 1, 'ip' => '1.1.1.1', 'rtt_min' => 1.5]]], $change));
};
check(
    ['target' => '8.8.8.8', 'hops' => [['ttl' => 1, 'ip' => '1.1.1.1', 'rtt_min' => 1.5]]],
    routeEnrichInput($body()),
    'a good body'
);
check(['target' => null, 'hops' => []], routeEnrichInput($body(['target' => null, 'hops' => []])), 'no target and no hops');
check(null, routeEnrichInput(''), 'an empty body');
check(null, routeEnrichInput('not json'), 'a body that is not JSON');
check(null, routeEnrichInput($body(['v' => 2])), 'another version');
check(null, routeEnrichInput($body(['target' => 'x.example'])), 'a target that is not an address');
check(null, routeEnrichInput($body(['hops' => array_fill(0, 65, ['ttl' => 1, 'ip' => '1.1.1.1', 'rtt_min' => 1])])), '65 hops');
$many = [];
for ($i = 1; $i <= 64; ++$i) {
    $many[] = ['ttl' => $i, 'ip' => '1.1.1.'.$i, 'rtt_min' => 1];
}
check(64, count(routeEnrichInput($body(['hops' => $many]))['hops']), '64 hops');
check(null, routeEnrichInput($body(['hops' => [['ttl' => 1, 'ip' => 'nope', 'rtt_min' => 1]]])), 'a hop with an address that is not one');
check(null, routeEnrichInput($body(['hops' => [['ttl' => 0, 'ip' => '1.1.1.1', 'rtt_min' => 1]]])), 'the hop 0');
check(null, routeEnrichInput($body(['hops' => [['ttl' => 65, 'ip' => '1.1.1.1', 'rtt_min' => 1]]])), 'the hop 65');
check(null, routeEnrichInput($body(['hops' => [['ttl' => '1', 'ip' => '1.1.1.1', 'rtt_min' => 1]]])), 'a hop number that is text');
check(null, routeEnrichInput($body(['hops' => [['ttl' => 1, 'ip' => '1.1.1.1', 'rtt_min' => -1]]])), 'a negative time');
check(null, routeEnrichInput($body(['hops' => [['ttl' => 1, 'ip' => '1.1.1.1', 'rtt_min' => 60001]]])), 'a time over a minute');
check(null, routeEnrichInput($body(['hops' => [['ttl' => 1, 'ip' => '1.1.1.1', 'rtt_min' => 'x']]])), 'a time that is text');
check(null, routeEnrichInput($body(['hops' => [['ttl' => 1, 'ip' => '1.1.1.1', 'rtt_min' => 1], ['ttl' => 1, 'ip' => '1.1.1.2', 'rtt_min' => 1]]])), 'the same hop twice');
check(null, routeEnrichInput($body(['hops' => ['a' => ['ttl' => 1, 'ip' => '1.1.1.1', 'rtt_min' => 1]]])), 'hops that are not a list');
check(null, routeEnrichInput(str_repeat(' ', 8193)), 'a body over 8192 bytes');
check(['target' => null, 'hops' => [['ttl' => 2, 'ip' => '2001:db8::1', 'rtt_min' => null]]], routeEnrichInput($body(['target' => null, 'hops' => [['ttl' => 2, 'ip' => '2001:db8::1']]])), 'an IPv6 hop with no time');

// routeEnrichAnswer: the scope is worked out here, an internal address is not asked about, and no address is in the answer
$asked = [];
$database = function ($address) use (&$asked) {
    $asked[] = $address;

    return ['asn' => 'AS15169', 'as_name' => 'Google LLC', 'country' => 'US', 'continent' => 'NA'];
};
$answer = routeEnrichAnswer(
    ['target' => '8.8.8.8', 'hops' => [
        ['ttl' => 1, 'ip' => '192.168.0.1', 'rtt_min' => 1.0],
        ['ttl' => 2, 'ip' => '100.64.0.1', 'rtt_min' => 2.0],
        ['ttl' => 3, 'ip' => '8.8.4.4', 'rtt_min' => 10.0],
    ]],
    $database
);
check(['8.8.4.4', '8.8.8.8'], $asked, 'only the public addresses are looked up');
check(null, $answer['hops'][0]['asn'], 'the internal address has no network');
check(null, $answer['hops'][1]['country'], 'the CGNAT address has no country');
check(['ttl' => 3, 'asn' => 'AS15169', 'as_name' => 'Google LLC', 'country' => 'US', 'country_doubt' => false], $answer['hops'][2], 'the public address has them');
check(['asn' => 'AS15169', 'as_name' => 'Google LLC'], $answer['target_as'], 'the network of the target');
check('US', $answer['target_country'], 'the country of the target');
check(false, false !== strpos(json_encode($answer), '8.8.4.4'), 'no address is in the answer');
check(false, false !== strpos(json_encode($answer), '192.168'), 'and no internal one either');
$answer = routeEnrichAnswer(['target' => '10.0.0.1', 'hops' => []], $database);
check(null, $answer['target_as'], 'a target that is not public is not looked up');
$answer = routeEnrichAnswer(['target' => null, 'hops' => [['ttl' => 1, 'ip' => '8.8.8.8', 'rtt_min' => null]]], function ($address) {
    return null;
});
check(['ttl' => 1, 'asn' => null, 'as_name' => null, 'country' => null, 'country_doubt' => false], $answer['hops'][0], 'with no database there is nothing to say');

// routeClientHourly: one visitor cannot use up the hour of the others
$hdir = sys_get_temp_dir().'/route-hourly-test-'.getmypid();
@mkdir($hdir, 0700, true);
$t0 = 1000000;
for ($i = 0; $i < 3; ++$i) {
    check(null, routeClientHourly($hdir, 'aa11', $t0 + $i * 10, 3), 'the request '.($i + 1).' of 3 in an hour passes');
}
check(['rate_client', 3600 - 30], routeClientHourly($hdir, 'aa11', $t0 + 30, 3), 'the fourth in an hour waits until the first is an hour old');
check(null, routeClientHourly($hdir, 'bb22', $t0 + 30, 3), 'another visitor is not held back');
check(null, routeClientHourly($hdir, 'aa11', $t0 + 3601, 3), 'an hour later it passes again');
array_map('unlink', glob($hdir.'/*') ?: []);
@rmdir($hdir);

// Static audit: nothing that goes through a shell, and proc_open only with an array
foreach (['route.php', 'route_util.php', 'route_enrich.php'] as $file) {
    $code = file_get_contents(__DIR__.'/../backend/'.$file);
    $calls = [];
    $backtick = false;
    foreach (token_get_all($code) as $token) {
        if (is_array($token) && T_STRING === $token[0]) {
            $calls[] = strtolower($token[1]);
        } elseif ('`' === $token) {
            $backtick = true;
        }
    }
    foreach (['exec', 'shell_exec', 'system', 'passthru', 'popen', 'pcntl_exec', 'eval'] as $bad) {
        check(false, in_array($bad, $calls, true), $file.' does not call '.$bad);
    }
    check(false, $backtick, $file.' has no backtick');
    check(0, preg_match('/proc_open\(\s*[\'"]/', $code), $file.': proc_open is called with an array, not a string');
}

if ($failures > 0) {
    fwrite(STDERR, $failures." failure(s)\n");
    exit(1);
}
echo "OK\n";
