<?php
// Tests of backend/route_enrich.php by HTTP, in plain PHP: the answers for a GET, a request with no header of its own, another
// Content-Type, a body that is not what is expected, the route turned off, the limit of one request every 5 seconds, and the headers
// of the answer. It starts the built-in server of PHP on a copy of the backend (with the route turned on, and once with it off).
//     docker run --rm -v "$PWD":/app -w /app php:8-apache php tests/route_enrich_http_test.php
// It needs the files of backend/ (the database of networks is read when it is there) and writes only in a folder of the system temp.

// PHP 8.5 deprecates $http_response_header, which older versions need: it is named by a variable variable so that the notice is not made
ini_set('display_errors', '0');
$failures = 0;
function check($expected, $actual, $what)
{
    global $failures;
    if ($expected !== $actual) {
        ++$failures;
        fwrite(STDERR, 'FAIL '.$what.': expected '.var_export($expected, true).', got '.var_export($actual, true)."\n");
    }
}

$backend = __DIR__.'/../backend';
$servers = [];
$roots = [];

function startServer($backend, $enabled, $port, &$servers, &$roots)
{
    $root = sys_get_temp_dir().'/route-enrich-http-'.getmypid().'-'.$port;
    mkdir($root, 0700, true);
    foreach (['route_enrich.php', 'route_util.php', 'country_asn.mmdb', 'geoip2.phar'] as $file) {
        if (is_file($backend.'/'.$file)) {
            copy($backend.'/'.$file, $root.'/'.$file);
        }
    }
    file_put_contents($root.'/route_settings.php', '<?php $route_enabled = '.($enabled ? 'true' : 'false').'; $route_trusted_proxies = ""; $route_ipv6 = false;');
    $process = proc_open(['php', '-S', '127.0.0.1:'.$port, '-t', $root], [['pipe', 'r'], ['pipe', 'w'], ['pipe', 'w']], $pipes);
    $servers[] = [$process, $pipes];
    $roots[] = $root;
    for ($i = 0; $i < 50; ++$i) {
        $socket = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.2);
        if ($socket) {
            fclose($socket);

            return;
        }
        usleep(100000);
    }
    fwrite(STDERR, "FAIL the server on $port did not start\n");
    exit(1);
}

function stopServers(&$servers, $roots)
{
    foreach ($servers as $server) {
        proc_terminate($server[0]);
        proc_close($server[0]);
    }
    foreach ($roots as $root) {
        exec('rm -rf '.escapeshellarg($root));
    }
}

/**
 * @return array [status, headers (lower case name => value), body]
 */
function request($port, $method, $headers, $body)
{
    $context = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body, 'ignore_errors' => true, 'timeout' => 10]]);
    $answer = @file_get_contents('http://127.0.0.1:'.$port.'/route_enrich.php', false, $context);
    $status = 0;
    $list = [];
    $lines = function_exists('http_get_last_response_headers') ? http_get_last_response_headers() : (isset(${'http_response_header'}) ? ${'http_response_header'} : []);
    foreach ((array) $lines as $line) {
        if (preg_match('#^HTTP/\S+ (\d+)#', $line, $m)) {
            $status = (int) $m[1];
        } elseif (false !== strpos($line, ':')) {
            list($name, $value) = explode(':', $line, 2);
            $list[strtolower(trim($name))] = trim($value);
        }
    }

    return [$status, $list, $answer];
}

// The limits are kept in the folder of the system temp: each case starts without them
function freeLimits()
{
    exec('rm -rf '.escapeshellarg(sys_get_temp_dir().'/librespeed-route'));
}

$on = 18391;
$off = 18392;
startServer($backend, true, $on, $servers, $roots);
startServer($backend, false, $off, $servers, $roots);

$json = ['Content-Type: application/json', 'X-LibreSpeed-Route: 1'];
$good = json_encode(['v' => 1, 'target' => '8.8.8.8', 'hops' => [['ttl' => 1, 'ip' => '8.8.8.8', 'rtt_min' => 1.5], ['ttl' => 2, 'ip' => '192.168.0.1', 'rtt_min' => 0.5]]]);

// Turned off: the same answer as route.php, and nothing else is looked at
freeLimits();
list($status, $headers, $answer) = request($off, 'POST', $json, $good);
check(404, $status, 'off: the status');
check(['v' => 1, 'enabled' => false], json_decode($answer, true), 'off: the body');

// A GET is not allowed, and says what is
freeLimits();
list($status, $headers, $answer) = request($on, 'GET', [], '');
check(405, $status, 'a GET: the status');
check('POST', isset($headers['allow']) ? $headers['allow'] : null, 'a GET: Allow');
check('method_not_allowed', json_decode($answer, true)['error'], 'a GET: the error');
list($status, $headers) = request($on, 'OPTIONS', ['Origin: https://other.example', 'Access-Control-Request-Method: POST', 'Access-Control-Request-Headers: x-librespeed-route'], '');
check(405, $status, 'a preflight is not answered');
check(false, isset($headers['access-control-allow-origin']), 'no CORS header on a preflight');

// The header of its own, and the Content-Type
freeLimits();
list($status, , $answer) = request($on, 'POST', ['Content-Type: application/json'], $good);
check(400, $status, 'no header of its own: the status');
check(['error' => 'bad_request'], json_decode($answer, true), 'no header of its own: the body');
list($status) = request($on, 'POST', ['Content-Type: application/json', 'X-LibreSpeed-Route: 0'], $good);
check(400, $status, 'the header with another value');
list($status) = request($on, 'POST', ['Content-Type: text/plain', 'X-LibreSpeed-Route: 1'], $good);
check(400, $status, 'another Content-Type');
list($status) = request($on, 'POST', ['X-LibreSpeed-Route: 1'], $good);
check(400, $status, 'no Content-Type');

// A body that is not what is expected: the limits are not used up by it
list($status) = request($on, 'POST', $json, 'not json');
check(400, $status, 'a body that is not JSON');
list($status) = request($on, 'POST', $json, json_encode(['v' => 2, 'target' => null, 'hops' => []]));
check(400, $status, 'another version');
list($status) = request($on, 'POST', $json, json_encode(['v' => 1, 'target' => null, 'hops' => [['ttl' => 1, 'ip' => 'nope', 'rtt_min' => 1]]]));
check(400, $status, 'an address that is not one');
list($status) = request($on, 'POST', $json, json_encode(['v' => 1, 'target' => null, 'hops' => [], 'pad' => str_repeat('x', 9000)]));
check(400, $status, 'a body over 8 KB');

// A good request: the answer, the headers, and no address given back
list($status, $headers, $answer) = request($on, 'POST', $json, $good);
check(200, $status, 'a good request: the status');
check('application/json; charset=utf-8', isset($headers['content-type']) ? $headers['content-type'] : null, 'a good request: Content-Type');
check('no-store', isset($headers['cache-control']) ? $headers['cache-control'] : null, 'a good request: Cache-Control');
check('nosniff', isset($headers['x-content-type-options']) ? $headers['x-content-type-options'] : null, 'a good request: nosniff');
check(false, isset($headers['access-control-allow-origin']), 'a good request: no CORS header');
$body = json_decode($answer, true);
check(1, $body['v'], 'a good request: v');
check(true, isset($body['hops'][0]['ttl']) && 1 === $body['hops'][0]['ttl'], 'the public hop is answered');
check(false, isset($body['hops'][1]['asn']) || isset($body['hops'][1]['country']), 'the internal hop has no network or country');
check(false, strpos($answer, '192.168') !== false, 'the internal address is not in the answer');

// The second request within 5 seconds is refused with the time to wait
list($status, $headers, $answer) = request($on, 'POST', $json, $good);
check(429, $status, 'the second request: the status');
check(true, isset($headers['retry-after']) && (int) $headers['retry-after'] >= 1 && (int) $headers['retry-after'] <= 5, 'the second request: Retry-After');
$limited = json_decode($answer, true);
check(true, isset($limited['error']) && isset($limited['retry_after']), 'the second request: the body');

stopServers($servers, $roots);
freeLimits();
if ($failures) {
    fwrite(STDERR, $failures." failure(s)\n");
    exit(1);
}
echo "OK\n";
