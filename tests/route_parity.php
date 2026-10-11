<?php

/**
 * Writes tests/e2e/fixtures/route-parity.json: what the PHP gives for the addresses and the outputs of tests/fixtures/route, so that the
 * parser of the page (route-parse.js) is held to the same answers. Run it again when route_util.php changes:
 *
 *   docker run --rm --entrypoint php -v "$PWD":/app -w /app librespeed-better-demo:backgrounds tests/route_parity.php
 */

require __DIR__.'/../backend/route_util.php';

$addresses = [
    '0.0.0.0', '0.255.255.255', '1.0.0.0', '1.1.1.1', '8.8.8.8', '9.255.255.255', '10.0.0.0', '10.255.255.255', '11.0.0.0',
    '100.63.255.255', '100.64.0.0', '100.127.255.255', '100.128.0.0', '126.255.255.255', '127.0.0.1', '128.0.0.1',
    '169.253.255.255', '169.254.0.1', '169.255.0.0', '172.15.255.255', '172.16.0.0', '172.31.255.255', '172.32.0.0',
    '191.255.255.255', '192.0.0.1', '192.0.1.1', '192.0.2.1', '192.0.3.1', '192.88.99.1', '192.167.255.255', '192.168.0.1',
    '192.169.0.0', '198.17.255.255', '198.18.0.1', '198.19.255.255', '198.20.0.0', '198.51.100.1', '198.51.101.1',
    '203.0.113.1', '203.0.114.1', '223.255.255.255', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '187.16.208.188', '72.14.208.80',
    '192.0.0.9', '192.0.0.10', '192.0.0.11', '::', '::1', '::2', '::ffff:1.2.3.4', '::ffff:0:0', '64:ff9b::1.2.3.4', '64:ff9b:1::1', '100::1', '100:0:0:1::1',
    '2001::1', '2001:1::1', '2001:2::1', '2001:4:112::1', '2001:10::1', '2001:20::1', '2001:db8::1', '2001:db7::1',
    '2002::1', '2003::1', '2400:cb00::1', '2606:4700:4700::1111', '2804:14c:1::1', '2a00:1450::1',
    '3fff::1', '3ffe::1', '5f00::1', 'fb00::1', 'fc00::1', 'fd12:3456::1', 'fe00::1', 'fe80::1', 'febf::1', 'fec0::1',
    'ff02::1', 'ff0e::1', '1::1',
];

$scopes = [];
foreach ($addresses as $address) {
    $scopes[$address] = routeHopScope($address);
}

$outputs = [];
foreach (glob(__DIR__.'/fixtures/route/*.txt') as $file) {
    $outputs[basename($file)] = routeSummarize(routeParse(file_get_contents($file)), []);
}

file_put_contents(
    __DIR__.'/e2e/fixtures/route-parity.json',
    json_encode(['util_md5' => md5_file(__DIR__.'/../backend/route_util.php'), 'scopes' => $scopes, 'outputs' => $outputs], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n"
);
echo count($scopes)." addresses, ".count($outputs)." outputs\n";
