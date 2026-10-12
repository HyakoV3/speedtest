<?php

/**
 * The route from this server to the visitor, for route-better.html
 *
 *   GET  route.php?caps  what this server can do (404 while the route is off)
 *   POST route.php       traces the route to the address this server saw for the visitor, and answers with the hops
 *
 * The target is never read from the request: only the address of the connection (or, behind a proxy listed in
 * route_settings.php, the one the proxy saw). Nothing of the visitor is written down but a name that does not tell the address.
 */

require __DIR__.'/route_settings.php';
require __DIR__.'/route_util.php';

define('ROUTE_BIN', '/usr/bin/traceroute');
define('ROUTE_WINDOW', 60);
define('ROUTE_HOURLY', 60);
define('ROUTE_SLOTS', 2);
define('ROUTE_DEADLINE', 15);
define('ROUTE_MAX_BYTES', 16384);
define('ROUTE_SILENT_STOP', 4);

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/**
 * @param int   $status
 * @param array $body
 */
function routeAnswer($status, array $body)
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

if (true !== $route_enabled) {
    routeAnswer(404, ['v' => 1, 'enabled' => false]);
}
if (PHP_VERSION_ID < 80200 || !function_exists('proc_open') || !is_executable(ROUTE_BIN)) {
    routeAnswer(503, ['v' => 1, 'error' => 'unavailable']);
}

$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
if ('GET' === $method && isset($_GET['caps'])) {
    routeAnswer(200, ['v' => 1, 'enabled' => true, 'ipv6' => true === $route_ipv6, 'window_s' => ROUTE_WINDOW, 'cli_url' => routeCliUrl($route_cli_url)]);
}
if ('POST' !== $method) {
    header('Allow: GET, POST');
    routeAnswer(405, ['v' => 1, 'error' => 'method_not_allowed']);
}
// A header of its own makes the browser ask first (CORS), which this endpoint does not answer: another site cannot start routes
// through the browser of whoever visits it
if (!isset($_SERVER['HTTP_X_LIBRESPEED_ROUTE']) || '1' !== $_SERVER['HTTP_X_LIBRESPEED_ROUTE']) {
    routeAnswer(400, ['error' => 'bad_request']);
}

$ip = routeClientIp($_SERVER, routeParseCidrList($route_trusted_proxies));
if (false === $ip) {
    routeAnswer(422, ['error' => 'no_client_ip']);
}
$error = routeTargetError($ip, true === $route_ipv6);
if (null !== $error) {
    routeAnswer(422, ['error' => $error]);
}

$dir = routeStateDir();
// The place and the tool come before the limits are written down: a "busy" or a "tool_missing" answer uses up nothing of the visitor's
// minute or of the hour of the server
list($refused, $wait, $slot) = routeBegin(
    $dir,
    routeClientKey($dir, $ip),
    time(),
    ROUTE_WINDOW,
    ROUTE_HOURLY,
    ROUTE_SLOTS,
    function () use ($dir) {
        return routeToolOk(ROUTE_BIN, $dir);
    }
);
if ('tool_missing' === $refused) {
    routeAnswer(503, ['error' => 'tool_missing']);
}
if (null !== $refused) {
    header('Retry-After: '.$wait);
    routeAnswer(429, ['error' => $refused, 'retry_after' => $wait]);
}

$family = false !== strpos($ip, ':') ? 6 : 4;
$started = microtime(true);
$run = routeRun(
    routeCommands(ROUTE_BIN, $ip, $family),
    $started + ROUTE_DEADLINE,
    ROUTE_MAX_BYTES,
    ['quick' => null, 'mtu' => ROUTE_SILENT_STOP]
);
fclose($slot);

$lookup = 'routeLookup';

$quick = routeParse($run['quick']['out']);
$mtu = routeParse($run['mtu']['out']);
$hops = routeEnrich(routeSummarize($quick, $mtu), $lookup);
$pmtu = routePmtu($mtu);
$reached = false;
foreach ($hops as $index => $hop) {
    if ($hop['ip'] === $ip) {
        $reached = true;
        $hops[$index]['is_target'] = true;
    } elseif ('public' === $hop['scope']) {
        $hops[$index]['is_target'] = false;
    }
}
$data = $lookup($ip);
$targetAs = is_array($data) && !empty($data['asn']) ? ['asn' => $data['asn'], 'as_name' => isset($data['as_name']) ? $data['as_name'] : null] : null;

routeAnswer(200, [
    'v' => 1,
    'direction' => 'server_to_client',
    'family' => $family,
    'elapsed_ms' => (int) round((microtime(true) - $started) * 1000),
    'stopped' => ['quick' => $run['quick']['stopped'], 'mtu' => $run['mtu']['stopped']],
    'target_reached' => $reached,
    'target_as' => $targetAs,
    'target_country' => routeTargetCountry($data),
    'pmtu' => $pmtu['pmtu'],
    'pmtu_drops' => $pmtu['drops'],
    'hops' => $hops,
]);
