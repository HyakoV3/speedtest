<?php

/**
 * Helpers of route.php: the route (traceroute) from this server to the visitor
 *
 * Only functions, nothing runs when the file is included, so they can be tested without a web server. The target of a
 * route is only ever the address the server saw for the visitor, and the command is run with an array of arguments, never
 * through a shell.
 */

/**
 * Whether an address is in a range
 *
 * @param string $ip   IPv4 or IPv6
 * @param string $cidr "10.0.0.0/8", "fd00::/8" or a single address (a /32 or a /128)
 *
 * @return bool false for anything that is not an address or a range
 */
function routeIpInCidr($ip, $cidr)
{
    if (!is_string($ip) || !is_string($cidr)) {
        return false;
    }
    $parts = explode('/', $cidr, 2);
    $address = @inet_pton($ip);
    $network = @inet_pton($parts[0]);
    if (false === $address || false === $network || strlen($address) !== strlen($network)) {
        return false;
    }
    $max = 8 * strlen($network);
    if (isset($parts[1])) {
        if (1 !== preg_match('/^\d{1,3}\z/', $parts[1]) || (int) $parts[1] > $max) {
            return false;
        }
        $bits = (int) $parts[1];
    } else {
        $bits = $max;
    }
    $whole = intdiv($bits, 8);
    if (substr($address, 0, $whole) !== substr($network, 0, $whole)) {
        return false;
    }
    $rest = $bits % 8;
    if (0 === $rest) {
        return true;
    }
    $mask = (0xFF << (8 - $rest)) & 0xFF;

    return (ord($address[$whole]) & $mask) === (ord($network[$whole]) & $mask);
}

/**
 * The proxies of the settings as a list: "10.0.0.1, 172.16.0.0/12" gives ["10.0.0.1", "172.16.0.0/12"]
 *
 * @param mixed $text
 *
 * @return string[] the items that are not an address or a range are left out
 */
function routeParseCidrList($text)
{
    $list = [];
    if (!is_string($text)) {
        return $list;
    }
    foreach (explode(',', $text) as $item) {
        $item = trim($item);
        if ('' !== $item && routeIsRange($item)) {
            $list[] = $item;
        }
    }

    return $list;
}

/**
 * Whether the text is an address or a range (the check routeIpInCidr() does of its second argument)
 *
 * @param string $text
 *
 * @return bool
 */
function routeIsRange($text)
{
    $parts = explode('/', $text, 2);
    $network = @inet_pton($parts[0]);
    if (false === $network) {
        return false;
    }
    if (!isset($parts[1])) {
        return true;
    }

    return 1 === preg_match('/^\d{1,3}\z/', $parts[1]) && (int) $parts[1] <= 8 * strlen($network);
}

/**
 * The address of the visitor
 *
 * Only REMOTE_ADDR and X-Forwarded-For are read, and the second only when the request comes from a trusted proxy, from the
 * right to the left (the proxy adds the address it saw at the end, the beginning of the list belongs to the client).
 * Client-IP, X-Real-IP and the others are never read: any client can send them.
 *
 * @param array    $server  $_SERVER
 * @param string[] $trusted proxies, as addresses or ranges
 *
 * @return string|false
 */
function routeClientIp(array $server, array $trusted)
{
    $remote = routeCleanIp(isset($server['REMOTE_ADDR']) ? $server['REMOTE_ADDR'] : null);
    if (false === $remote) {
        return false;
    }
    if (!routeIsTrusted($remote, $trusted)) {
        return $remote;
    }
    $forwarded = isset($server['HTTP_X_FORWARDED_FOR']) ? $server['HTTP_X_FORWARDED_FOR'] : null;
    if (!is_string($forwarded) || '' === trim($forwarded)) {
        return false;
    }
    $items = array_reverse(explode(',', $forwarded));
    foreach ($items as $item) {
        $ip = routeCleanIp(trim($item));
        if (false === $ip) {
            return false;
        }
        if (!routeIsTrusted($ip, $trusted)) {
            return $ip;
        }
    }

    return false;
}

/**
 * A valid address, with the "::ffff:" of a mapped IPv4 address taken out
 *
 * @param mixed $value
 *
 * @return string|false
 */
function routeCleanIp($value)
{
    if (!is_string($value) || $value !== trim($value) || false === filter_var($value, FILTER_VALIDATE_IP)) {
        return false;
    }
    if (1 === preg_match('/^::ffff:(\d{1,3}(\.\d{1,3}){3})\z/i', $value, $match)
        && false !== filter_var($match[1], FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        return $match[1];
    }

    return $value;
}

/**
 * @param string   $ip
 * @param string[] $trusted
 *
 * @return bool
 */
function routeIsTrusted($ip, array $trusted)
{
    foreach ($trusted as $range) {
        if (routeIpInCidr($ip, $range)) {
            return true;
        }
    }

    return false;
}

/**
 * Why an address cannot be the target of a route, or null when it can
 *
 * @param mixed $ip
 * @param bool  $allowIpv6
 *
 * @return string|null "invalid", "ipv6" or "not_global"
 */
function routeTargetError($ip, $allowIpv6)
{
    if (!is_string($ip) || $ip !== trim($ip) || false === filter_var($ip, FILTER_VALIDATE_IP)) {
        return 'invalid';
    }
    if (false !== strpos($ip, ':') && !$allowIpv6) {
        return 'ipv6';
    }
    if (false === filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_GLOBAL_RANGE)
        || routeIpInCidr($ip, '224.0.0.0/4')
        || routeIpInCidr($ip, '100.64.0.0/10')
        || routeIpInCidr($ip, 'ff00::/8')
        || routeIpInCidr($ip, '64:ff9b::/96')
        || routeIpInCidr($ip, '::ffff:0:0/96')
        || routeIpInCidr($ip, '2002::/16')
        || routeIpInCidr($ip, 'fec0::/10')) {
        return 'not_global';
    }

    return null;
}

/**
 * What a router of the route is: "none" (it did not answer), "cgnat", "private" (internal network) or "public"
 *
 * @param string|null $ip
 *
 * @return string
 */
function routeHopScope($ip)
{
    if (null === $ip) {
        return 'none';
    }
    if (routeIpInCidr($ip, '100.64.0.0/10')) {
        return 'cgnat';
    }
    if (false === filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_GLOBAL_RANGE)) {
        return 'private';
    }

    return 'public';
}

/**
 * The two commands of a route, as arrays of arguments: the list of routers with 3 times each (quick) and the one that
 * shows the MTU of the path (mtu)
 *
 * @param string $bin
 * @param mixed  $ip     the target, checked here again
 * @param int    $family 4 or 6
 *
 * @return array|null null when the target is not one that can be traced
 */
function routeCommands($bin, $ip, $family)
{
    if (null !== routeTargetError($ip, true)) {
        return null;
    }
    $quick = [$bin, '-n', '-q', '3', '-w', '1', '-m', '20'];
    $mtu = [$bin, '-n', '--mtu', '-q', '1', '-w', '1', '-m', '20'];
    if (6 === $family) {
        array_splice($quick, 1, 0, '-6');
        array_splice($mtu, 1, 0, '-6');
    }
    $quick[] = $ip;
    $mtu[] = $ip;

    return ['quick' => $quick, 'mtu' => $mtu];
}

/**
 * The hops of the output of traceroute
 *
 * A line of a hop is a number (1 to 20) followed by addresses, times ("12.3 ms"), "*" for an answer that did not come, "F=1500"
 * (the MTU) and flags ("!H"). An address is for the times that come after it, up to the next address (a hop with more than one
 * router answering). Everything else is ignored.
 *
 * @param mixed $text
 *
 * @return array[] ['ttl' => int, 'ips' => [address => [times]], 'lost' => int, 'flags' => string[], 'mtu' => int|null]
 */
function routeParse($text)
{
    $hops = [];
    if (!is_string($text)) {
        return $hops;
    }
    foreach (preg_split('/\r?\n/', $text) as $line) {
        if (1 !== preg_match('/^\s*(\d{1,2})\s+(\S.*)\z/', $line, $match)) {
            continue;
        }
        $ttl = (int) $match[1];
        if ($ttl < 1 || $ttl > 20) {
            continue;
        }
        $hop = routeParseHop($match[2]);
        if (null === $hop) {
            continue;
        }
        if (!isset($hops[$ttl])) {
            $hops[$ttl] = ['ttl' => $ttl, 'ips' => [], 'lost' => 0, 'flags' => [], 'mtu' => null];
        }
        $hops[$ttl]['lost'] += $hop['lost'];
        $hops[$ttl]['mtu'] = null === $hop['mtu'] ? $hops[$ttl]['mtu'] : $hop['mtu'];
        foreach ($hop['ips'] as $ip => $times) {
            $hops[$ttl]['ips'][$ip] = array_merge(isset($hops[$ttl]['ips'][$ip]) ? $hops[$ttl]['ips'][$ip] : [], $times);
        }
        $hops[$ttl]['flags'] = array_values(array_unique(array_merge($hops[$ttl]['flags'], $hop['flags'])));
    }
    ksort($hops);

    return array_values($hops);
}

/**
 * The part of a line of a hop that comes after its number
 *
 * @param string $rest
 *
 * @return array|null null when there is nothing in it that can be used
 */
function routeParseHop($rest)
{
    $tokens = preg_split('/\s+/', trim($rest));
    $hop = ['ips' => [], 'lost' => 0, 'flags' => [], 'mtu' => null];
    $current = null;
    $count = count($tokens);
    for ($i = 0; $i < $count; ++$i) {
        $token = $tokens[$i];
        if ('*' === $token) {
            ++$hop['lost'];
        } elseif (is_numeric($token) && $i + 1 < $count && 'ms' === $tokens[$i + 1]) {
            if (null !== $current) {
                $hop['ips'][$current][] = (float) $token;
            }
            ++$i;
        } elseif (1 === preg_match('/^F=(\d{1,5})\z/', $token, $found)) {
            $hop['mtu'] = (int) $found[1];
        } elseif (1 === preg_match('/^!(H|N|P|S|X|V|C|F-\d+|\d+)\z/', $token)) {
            $hop['flags'][] = $token;
        } elseif (false !== filter_var($token, FILTER_VALIDATE_IP)) {
            $current = $token;
            if (!isset($hop['ips'][$current])) {
                $hop['ips'][$current] = [];
            }
        } elseif (1 === preg_match('/^[0-9a-fA-F:.]+\z/', $token)) {
            // Something that looks like an address but is not one: its times are not for the address before it
            $current = null;
        }
    }
    if (!$hop['ips'] && 0 === $hop['lost'] && null === $hop['mtu']) {
        return null;
    }

    return $hop;
}

/**
 * The hops of the route, one for each number, as the page shows them
 *
 * The times come from the list with 3 times for each hop (quick); the other one (mtu) is the reserve when that one is empty.
 * The hops at the end that did not answer are left out: it is the part of the route nobody will tell.
 *
 * @param array[] $quick routeParse() of the quick command
 * @param array[] $mtu   routeParse() of the mtu command
 *
 * @return array[]
 */
function routeSummarize(array $quick, array $mtu)
{
    $source = $quick ? $quick : $mtu;
    $hops = [];
    foreach ($source as $hop) {
        $ip = null;
        $best = 0;
        $times = [];
        foreach ($hop['ips'] as $address => $list) {
            $times = array_merge($times, $list);
            if (count($list) > $best) {
                $best = count($list);
                $ip = (string) $address;
            }
        }
        if (null === $ip && $hop['ips']) {
            $ip = (string) key($hop['ips']);
        }
        $others = [];
        foreach (array_keys($hop['ips']) as $address) {
            if ((string) $address !== $ip) {
                $others[] = (string) $address;
            }
        }
        $answered = count($times);
        $hops[] = [
            'ttl' => $hop['ttl'],
            'ip' => $ip,
            'alt_ips' => $others,
            'rtt_min' => $answered ? round(min($times), 2) : null,
            'rtt_avg' => $answered ? round(array_sum($times) / $answered, 2) : null,
            'sent' => $answered + $hop['lost'],
            'answered' => $answered,
            'flags' => $hop['flags'],
            'scope' => routeHopScope($answered ? $ip : null),
        ];
    }
    while ($hops && 'none' === $hops[count($hops) - 1]['scope']) {
        array_pop($hops);
    }

    return $hops;
}

/**
 * The MTU of the path and where it drops, from the "F=" of the mtu command
 *
 * The MTU is unknown (null) when no hop says it, or when one says more than 1500: it is the MTU of the container of the
 * server (a container with 65520, for example), not of the path, and it would be shown as if it were.
 *
 * @param array[] $mtu routeParse() of the mtu command
 *
 * @return array ['pmtu' => int|null, 'drops' => [['ttl' => int, 'from' => int, 'to' => int]]]
 */
function routePmtu(array $mtu)
{
    $drops = [];
    $last = null;
    foreach ($mtu as $hop) {
        if (null === $hop['mtu']) {
            continue;
        }
        if ($hop['mtu'] < 1 || $hop['mtu'] > 1500) {
            return ['pmtu' => null, 'drops' => []];
        }
        if (null !== $last && $hop['mtu'] < $last) {
            $drops[] = ['ttl' => $hop['ttl'], 'from' => $last, 'to' => $hop['mtu']];
        }
        $last = $hop['mtu'];
    }

    return ['pmtu' => $last, 'drops' => $last ? $drops : []];
}

/**
 * Adds the network and the country to the public hops, from a database of addresses
 *
 * A country that cannot be right is marked: the first public hop with a continent is where the server is, so a hop in another
 * continent that answers in less than 20 ms (light does not go so far in that time) is "country_doubt".
 *
 * @param array[]  $hops   routeSummarize()
 * @param callable $lookup function ($ip) { return ['asn' => ..., 'as_name' => ..., 'country' => ..., 'continent' => ...] or null }
 *
 * @return array[]
 */
function routeEnrich(array $hops, callable $lookup)
{
    $anchor = null;
    foreach ($hops as $index => $hop) {
        if ('public' !== $hop['scope']) {
            continue;
        }
        $data = $lookup($hop['ip']);
        $data = is_array($data) ? $data : [];
        foreach (['asn', 'as_name', 'country', 'continent'] as $field) {
            $hops[$index][$field] = isset($data[$field]) && is_string($data[$field]) && '' !== $data[$field] ? $data[$field] : null;
        }
        if (null === $anchor && null !== $hops[$index]['continent']) {
            $anchor = $hops[$index]['continent'];
        }
    }
    foreach ($hops as $index => $hop) {
        if ('public' !== $hop['scope']) {
            continue;
        }
        $hops[$index]['country_doubt'] = null !== $anchor
            && null !== $hop['continent']
            && $hop['continent'] !== $anchor
            && null !== $hop['rtt_min']
            && $hop['rtt_min'] < 20;
    }

    return $hops;
}

/**
 * The country of the visitor, from what the database gave for the address of the visitor (the same answer as target_as)
 *
 * @param mixed $data the answer of the database, or null
 *
 * @return string|null two capital letters, or null
 */
function routeTargetCountry($data)
{
    if (!is_array($data) || !isset($data['country']) || !is_string($data['country'])) {
        return null;
    }

    return 1 === preg_match('/^[A-Z]{2}\z/', $data['country']) ? $data['country'] : null;
}

/**
 * The folder where the state of the limits is kept (only a random name, a counter and locks: no address)
 *
 * @return string
 */
function routeStateDir()
{
    $dir = sys_get_temp_dir().'/librespeed-route';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }

    return $dir;
}

/**
 * A name for a visitor in the limits, that does not tell the address: a keyed hash with a secret that changes every day
 *
 * @param string $dir
 * @param string $ip
 *
 * @return string 32 hexadecimal characters
 */
function routeClientKey($dir, $ip)
{
    $file = $dir.'/secret';
    $secret = is_file($file) && time() - (int) filemtime($file) < 86400 ? file_get_contents($file) : false;
    if (!is_string($secret) || 32 !== strlen($secret)) {
        $secret = random_bytes(32);
        file_put_contents($file, $secret, LOCK_EX);
        @chmod($file, 0600);
    }

    return substr(hash_hmac('sha256', $ip, $secret), 0, 32);
}

/**
 * Lets a route start, or says how long to wait
 *
 * One route for each visitor in $window seconds, and no more than $hourly in an hour in all. Everything is done with the file
 * state.lock locked, so two requests cannot both pass.
 *
 * @param string $dir
 * @param string $key    routeClientKey()
 * @param int    $now    the time, a parameter so that it can be tested
 * @param int    $window
 * @param int    $hourly
 *
 * @return array|null null when it can start, otherwise ["rate_client"|"rate_server", seconds to wait]
 */
function routeAdmit($dir, $key, $now, $window, $hourly)
{
    if (1 !== preg_match('/^[0-9a-f]{1,64}\z/', $key)) {
        $key = md5($key);
    }
    $lock = fopen($dir.'/state.lock', 'c');
    if (false === $lock || !flock($lock, LOCK_EX)) {
        return ['rate_server', $window];
    }
    $result = null;
    foreach (glob($dir.'/rl-*') ?: [] as $file) {
        if ((int) filemtime($file) < $now - $window) {
            @unlink($file);
        }
    }
    $mine = $dir.'/rl-'.$key;
    $hours = [];
    $saved = is_file($dir.'/hourly.json') ? json_decode((string) file_get_contents($dir.'/hourly.json'), true) : null;
    foreach (is_array($saved) ? $saved : [] as $time) {
        if (is_int($time) && $time > $now - 3600) {
            $hours[] = $time;
        }
    }
    if (is_file($mine)) {
        $result = ['rate_client', max(1, $window - ($now - (int) filemtime($mine)))];
    } elseif (count($hours) >= $hourly) {
        $result = ['rate_server', max(1, min($hours) + 3600 - $now)];
    } else {
        touch($mine, $now);
        $hours[] = $now;
        file_put_contents($dir.'/hourly.json', json_encode($hours));
    }
    flock($lock, LOCK_UN);
    fclose($lock);

    return $result;
}

/**
 * Takes one of the places for routes that run at the same time
 *
 * @param string $dir
 * @param int    $slots
 *
 * @return resource|false the open file (closing it frees the place), or false when all are taken
 */
function routeAcquireSlot($dir, $slots)
{
    for ($i = 0; $i < $slots; ++$i) {
        $handle = fopen($dir.'/slot-'.$i.'.lock', 'c');
        if (false === $handle) {
            continue;
        }
        if (flock($handle, LOCK_EX | LOCK_NB)) {
            return $handle;
        }
        fclose($handle);
    }

    return false;
}

/**
 * Lets a route start, in an order in which a route that does not run uses nothing up: first a free place, then the tool, and only
 * then the limits of the visitor and of the server are written down. A visitor that finds all the places taken, or a server
 * with no traceroute, has not spent its minute or one of the routes of the hour; a visitor that is refused by a limit gives
 * the place back.
 *
 * @param string   $dir
 * @param string   $key    routeClientKey()
 * @param int      $now
 * @param int      $window
 * @param int      $hourly
 * @param int      $slots
 * @param callable $toolOk returns whether traceroute can be used
 *
 * @return array [null|"busy"|"tool_missing"|"rate_client"|"rate_server", seconds to wait or null, the place (close it when the route
 *               is done) or null]
 */
function routeBegin($dir, $key, $now, $window, $hourly, $slots, callable $toolOk)
{
    $slot = routeAcquireSlot($dir, $slots);
    if (false === $slot) {
        return ['busy', 15, null];
    }
    if (!$toolOk()) {
        fclose($slot);

        return ['tool_missing', null, null];
    }
    $denied = routeAdmit($dir, $key, $now, $window, $hourly);
    if (null !== $denied) {
        fclose($slot);

        return [$denied[0], $denied[1], null];
    }

    return [null, null, $slot];
}

/**
 * Runs the commands at the same time and reads what they write
 *
 * Each command is an array of arguments for proc_open(): no shell, nothing of the visitor in a string. A command is stopped
 * when it writes more than $maxBytes, when it shows $silentStop[name] hops in a row with no answer (only "*"), or when
 * $deadline arrives.
 *
 * @param array[]   $commands   name => [program, argument, ...]
 * @param float     $deadline   microtime(true) when everything is stopped
 * @param int       $maxBytes
 * @param int[]|null[] $silentStop name => hops in a row, or null for no limit
 * @param bool      $withErrors whether what a command writes to the error output is read too (the version of traceroute is written there)
 *
 * @return array name => ['out' => string, 'stopped' => 'eof'|'silent'|'size'|'deadline']
 */
function routeRun(array $commands, $deadline, $maxBytes, array $silentStop, $withErrors = false)
{
    $env = ['PATH' => '/usr/bin:/bin', 'LC_ALL' => 'C'];
    $running = [];
    $result = [];
    foreach ($commands as $name => $command) {
        $result[$name] = ['out' => '', 'stopped' => 'eof'];
        $spec = [0 => ['file', '/dev/null', 'r'], 1 => ['pipe', 'w'], 2 => $withErrors ? ['redirect', 1] : ['file', '/dev/null', 'w']];
        $process = @proc_open($command, $spec, $pipes, null, $env);
        if (!is_resource($process)) {
            continue;
        }
        stream_set_blocking($pipes[1], false);
        $running[$name] = ['process' => $process, 'pipe' => $pipes[1], 'buffer' => '', 'silent' => 0];
    }
    while ($running) {
        if (microtime(true) >= $deadline) {
            foreach (array_keys($running) as $name) {
                routeStop($running, $result, $name, 'deadline');
            }
            break;
        }
        $read = [];
        foreach ($running as $item) {
            $read[] = $item['pipe'];
        }
        $write = null;
        $except = null;
        if (false === @stream_select($read, $write, $except, 0, 200000)) {
            usleep(50000);
        }
        foreach (array_keys($running) as $name) {
            $pipe = $running[$name]['pipe'];
            if (!in_array($pipe, $read, true)) {
                continue;
            }
            $chunk = fread($pipe, 8192);
            if (false === $chunk || ('' === $chunk && feof($pipe))) {
                routeStop($running, $result, $name, 'eof');
                continue;
            }
            $result[$name]['out'] .= $chunk;
            if (strlen($result[$name]['out']) > $maxBytes) {
                $result[$name]['out'] = substr($result[$name]['out'], 0, $maxBytes);
                routeStop($running, $result, $name, 'size');
                continue;
            }
            $limit = isset($silentStop[$name]) ? $silentStop[$name] : null;
            if (null !== $limit && routeSilentReached($running[$name], $chunk, $limit)) {
                routeStop($running, $result, $name, 'silent');
            }
        }
    }

    return $result;
}

/**
 * Counts, line by line, the hops in a row that have no answer. Lines that are not finished wait for the rest.
 *
 * @param array  $item  the command that is running (its buffer and its count are kept in it)
 * @param string $chunk what came now
 * @param int    $limit
 *
 * @return bool whether $limit hops in a row were reached
 */
function routeSilentReached(array &$item, $chunk, $limit)
{
    $item['buffer'] .= $chunk;
    while (false !== ($end = strpos($item['buffer'], "\n"))) {
        $line = substr($item['buffer'], 0, $end);
        $item['buffer'] = substr($item['buffer'], $end + 1);
        if (1 !== preg_match('/^\s*\d{1,2}\s+(\S.*)\z/', $line, $match)) {
            continue;
        }
        if (1 === preg_match('/^(\*|F=\d+)(\s+(\*|F=\d+))*\s*\z/', $match[1])) {
            if (++$item['silent'] >= $limit) {
                return true;
            }
        } else {
            $item['silent'] = 0;
        }
    }

    return false;
}

/**
 * Stops a command and takes it out of the ones that run
 *
 * @param array  $running
 * @param array  $result
 * @param string $name
 * @param string $reason
 */
function routeStop(array &$running, array &$result, $name, $reason)
{
    $item = $running[$name];
    if ('eof' !== $reason) {
        proc_terminate($item['process'], 9);
    }
    fclose($item['pipe']);
    proc_close($item['process']);
    $result[$name]['stopped'] = $reason;
    unset($running[$name]);
}

/**
 * Whether the program that traces the route is there and is the one that has what is needed (the "Modern traceroute" has
 * --mtu; the one of busybox does not). The answer is kept for a day.
 *
 * @param string $bin
 * @param string $dir
 *
 * @return bool
 */
function routeToolOk($bin, $dir)
{
    if (!is_executable($bin)) {
        return false;
    }
    $file = $dir.'/tool-ok';
    if (is_file($file) && time() - (int) filemtime($file) < 86400) {
        return '1' === file_get_contents($file);
    }
    $run = routeRun(['v' => [$bin, '--version']], microtime(true) + 3, 4096, [], true);
    $ok = false !== strpos($run['v']['out'], 'Modern traceroute');
    file_put_contents($file, $ok ? '1' : '0', LOCK_EX);

    return $ok;
}
