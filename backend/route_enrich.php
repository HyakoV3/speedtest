<?php

/**
 * The network and the country of routers, for the route that the visitor traced on their own device (route-better.html, "You → server")
 *
 *   POST route_enrich.php  { "v": 1, "target": "<address or null>", "hops": [ { "ttl": 1, "ip": "<address>", "rtt_min": 1.2 } ] }
 *
 * It only reads the database of networks and countries: it sends nothing to anyone, runs nothing and writes down nothing about the
 * addresses it is given. It is the same data that route.php puts in the route it traces, so it tells nothing that was not public.
 */

require __DIR__.'/route_settings.php';
require __DIR__.'/route_util.php';

define('ROUTE_ENRICH_WINDOW', 5);
define('ROUTE_ENRICH_HOURLY', 3600);
define('ROUTE_ENRICH_CLIENT_HOURLY', 120);

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/**
 * @param int   $status
 * @param array $body
 */
function routeEnrichSend($status, array $body)
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

if (true !== $route_enabled) {
    routeEnrichSend(404, ['v' => 1, 'enabled' => false]);
}
$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '';
if ('POST' !== $method) {
    header('Allow: POST');
    routeEnrichSend(405, ['v' => 1, 'error' => 'method_not_allowed']);
}
// A header of its own makes the browser ask first (CORS), which this endpoint does not answer: another site cannot use it through
// the browser of whoever visits it
if (!isset($_SERVER['HTTP_X_LIBRESPEED_ROUTE']) || '1' !== $_SERVER['HTTP_X_LIBRESPEED_ROUTE']) {
    routeEnrichSend(400, ['error' => 'bad_request']);
}
$type = isset($_SERVER['CONTENT_TYPE']) ? strtolower((string) $_SERVER['CONTENT_TYPE']) : '';
if (0 !== strpos($type, 'application/json')) {
    routeEnrichSend(400, ['error' => 'bad_request']);
}

$ip = routeClientIp($_SERVER, routeParseCidrList($route_trusted_proxies));
if (false === $ip) {
    routeEnrichSend(422, ['error' => 'no_client_ip']);
}

// The body is read up to one byte more than the limit, so that a body that is too big is seen as one
$input = routeEnrichInput(file_get_contents('php://input', false, null, 0, 8193));
if (null === $input) {
    routeEnrichSend(400, ['error' => 'bad_request']);
}

// Its own folder of limits: asking for the networks of a route does not use up the minute of tracing a route
$base = routeStateDir();
$dir = $base.'/enrich';
if (!is_dir($dir)) {
    @mkdir($dir, 0700, true);
}
$key = routeClientKey($base, $ip);
// The hour of one visitor first, so that a visitor that is over it does not use up the hour of all the others
$denied = routeClientHourly($dir, $key, time(), ROUTE_ENRICH_CLIENT_HOURLY);
if (null === $denied) {
    $denied = routeAdmit($dir, $key, time(), ROUTE_ENRICH_WINDOW, ROUTE_ENRICH_HOURLY);
}
if (null !== $denied) {
    header('Retry-After: '.$denied[1]);
    routeEnrichSend(429, ['error' => $denied[0], 'retry_after' => $denied[1]]);
}

routeEnrichSend(200, routeEnrichAnswer($input, 'routeLookup'));
