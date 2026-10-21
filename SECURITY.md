# Security

This is a personal fork of [LibreSpeed](https://github.com/librespeed/speedtest) (`HyakoV3/speedtest`). It is maintained on a
best-effort basis: there is no service level, no bug bounty and no security audit by a third party. What follows says what
the code does and where it is weak, so that you can decide how to run it.

## Reporting a vulnerability

Please do not open a public issue or pull request for a vulnerability. Use the repository's private channel instead:
**Security** tab → **Report a vulnerability** (GitHub private vulnerability reporting). Say what you found, how to reproduce it,
and which commit or image you tested. You will get an answer when the maintainer can give one; there is no fixed time.

Only the current `master` and the image built from it are supported. Problems that exist in the upstream LibreSpeed code
(for example in `backend/getIP_util.php`) are also welcome here, but may be better reported to
[upstream](https://github.com/librespeed/speedtest) as well.

## What is exposed, and what to do about it

### The stats page and the telemetry (`results/`)

- In the Docker image the `results/` folder only exists when `TELEMETRY=true`. Outside Docker it is part of the web root whatever
  `settings.json` says, and `telemetry.php` accepts any request.
- **The stats password has a default.** The image sets `PASSWORD=password`. Without a value of your own, the stats page
  (`results/stats.php`) accepts `password`. An empty value (`-e PASSWORD=`) is worse: an empty password logs in. Always set
  `PASSWORD` to a strong value when telemetry is on. The `doc_docker.md` of earlier versions said the page refused access
  without a password; that was wrong.
- The value of `PASSWORD`, `DB_USERNAME`, `DB_PASSWORD` and `IPINFO_APIKEY` is written into PHP files by `docker/entrypoint.sh`
  with `sed` and no escaping. Do not use `'`, `"`, `\`, `/`, `&` or `$` in them: they break the generated file or change what
  it does. Use letters, digits and `-_.`.
- `telemetry.php` has no authentication and no size limit of its own. The image raises `post_max_size` to 32 MB (for the upload
  test), so a single request can store a very large row. Put a rate limit and a body limit on `/results/telemetry.php` in your
  reverse proxy if the server is public.
- The address stored by the telemetry comes from `getClientIp()` (`backend/getIP_util.php`), which trusts `CF-Connecting-IPv6`,
  `Client-IP`, `X-Real-IP` and `X-Forwarded-For` (the first item of the list). Any client can forge it, so the addresses in the stats are not evidence of anything.
  The route page does **not** use this function (see below).
- `results/sanitycheck.php` is public, writes a test row on every visit and shows the database error text on failure, which can
  tell the host, user and file paths. Delete or block it after the installation.
- `results/json.php` and `results/index.php?id=` are public. Result ids are sequential unless `ENABLE_ID_OBFUSCATION=true`;
  the obfuscation hides the numbering, it is not cryptography.
- `REDACT_IP_ADDRESSES=true` removes addresses and host names from what the telemetry stores.

### Code that writes into the web root

`backend/getIP.php` writes `getIP_serverLocation.php` (a PHP file) next to itself, `results/idObfuscation.php` writes the
salt into `results/`, and the image gives the whole web root to `www-data`. Any file-write bug in PHP is therefore a code
execution bug. Do not add upload or file-write features to this tree, and keep the web server user away from anything else.

### HTTP headers

The Docker image sends `Cross-Origin-Opener-Policy: same-origin` and `X-Content-Type-Options: nosniff`, and cache lifetimes
(`docker/librespeed-headers.conf`). It sends **no** Content-Security-Policy, no `X-Frame-Options` or `frame-ancestors` (the
pages can be framed) and no HSTS; add them in your reverse proxy. A non-Docker installation gets none of these headers.
`?cors` makes `getIP.php`, `garbage.php` and `empty.php` answer with `Access-Control-Allow-Origin: *`, as in upstream.
`garbage.php` can send up to 1 GiB per request and has no rate limit.

### The ISP lookup and what leaves the server

By default the page loads fonts, scripts and map data from the same server, and the server sends nothing about the visitor to a third
party. There are two exceptions. (1) If you set `IPINFO_APIKEY`, `backend/getIP.php` sends the visitor's address to `ipinfo.io`
whenever the client asks for ISP information (`getIP.php?isp`); to measure the distance it also asks ipinfo.io for the location of
the server itself (no visitor address in that request) and caches it in `backend/getIP_serverLocation.php`. Without a key it only
reads the offline database in `backend/`. (2) The stability test can ping Google, Cloudflare or Apple: when the visitor picks one of
them, the browser requests it directly, so that company sees the visitor's address.

### The route page

The route page is the only feature of this fork that makes the server run a program (`traceroute`) because of a request from the
internet, so it is **off by default** (`ENABLE_ROUTE`, `$route_enabled`). See [docs/route.md](docs/route.md) for how to run it.

What it does to stay safe:

- The target is never read from the request. It is the address of the connection, or, behind a proxy you list in
  `ROUTE_TRUSTED_PROXIES`, the first address of `X-Forwarded-For`, reading from the right, that is not itself one of the trusted proxies. An invalid item in the list gives the error `no_client_ip`. Other headers
  (`Forwarded`, `X-Real-IP`, `Client-IP`) are not read. Private, loopback and other non-public addresses are refused.
- The program is run with a fixed path and arguments, without a shell, and needs no extra privilege (UDP probes only).
- Limits (`backend/route.php`): one route per visitor each minute, 60 an hour **for the whole server**, 2 at the same time, 15
  seconds each, and the output of `traceroute` is cut at 16 KB. `route.php` reads no request body. The enrichment of a pasted route
  (`backend/route_enrich.php`) takes a body of at most 8 KB, allows one request every 5 seconds and 120 an hour for each visitor,
  3600 an hour for the whole server, and only reads the offline database.

What to know:

- The per-visitor limit is keyed on the whole address. A visitor on IPv6 can change address inside their own prefix and escape
  it, and one client can use up the 60 routes an hour of everyone else. The server-wide limit is the real protection.
- **List only proxies you control** in `ROUTE_TRUSTED_PROXIES`, and never a range that clients can reach directly: any of them could
  choose the address to trace. Behind a public proxy or a CDN that is *not* listed, the server sees the proxy's public address
  and traces the route to the edge of the CDN, not to the visitor. Behind a private proxy that is not listed, every visitor
  looks private and the page says there is no internet route.
- What is kept on the server: a keyed hash of the visitor's address (the key is a random secret renewed when it is more than a day
  old, at the next request), and the times of the requests, in files under `<temp dir>/librespeed-route` (`/tmp/librespeed-route`
  by default). The per-visitor files are removed on the next request after their window (a minute for the route, an hour for the
  enrichment), not by a timer, so with no traffic they stay. A few shared files (the secret, the hourly counter, a cache of whether
  `traceroute` works, locks) are never deleted, only overwritten. The hash is a pseudonym, not an anonymous value: whoever can read that folder during the day can
  test addresses against it. Nothing else of the visitor is written.
- Outside Docker, on a host with other users, create that folder yourself (mode `0700`, owned by the web server user) or give the
  web server a private temp dir (for example systemd `PrivateTmp=yes`). The code does not check the owner of an existing folder.
- The country and network of a router come from `backend/country_asn.mmdb` and are approximate.

### The browser extension and the command line program

The way-back feature can use [`librespeed-route`](https://github.com/HyakoV3/librespeed-route) (a small Go program) and its
browser extension, in a separate repository. The extension talks to the program with Native Messaging; the program accepts
only a fixed set of requests, an IP literal as target, and no shell. The extension asks for the permission of each site you use
it on, and the page only accepts messages from its own window with an exact set of keys. A script running on the same page can
still hand the page a route line, which is acceptable because the page treats it like pasted text. The details of the protocol
are in that repository.

### What is stored in the browser

All of this stays in the visitor's browser (`localStorage`) and is sent nowhere:

- the detailed history of speed tests, **with the visitor's IP address**, no fixed limit (the space of the browser is the limit);
- the summary of results, up to 2000 rows, without an address;
- the history of stability tests (pings only for the latest ones);
- the history of routes: up to 100, the latest 20 with all the hops **and their addresses**;
- the choices of the options panel, the consent and other small settings of the pages (the names all start with
  `librespeed-better-`).

Anyone who uses the same browser profile can read them. "Clear" in the history removes them.

### Other things to know

- `backend/getIP_ipInfo_apikey.php` and `results/telemetry_settings.php` are tracked by git. On a classic installation, do not
  commit your key or password: keep the configuration outside the repository, or use `git update-index --skip-worktree`.
- The Docker build downloads `install-php-extensions` from its `latest` release and does not pin it.
- Third-party data: the offline database of networks and countries is from ipinfo (CC BY-SA 4.0, attribution required) and
  `geoip2.phar` is from MaxMind (Apache-2.0). The licence files of five of the six fonts are in `frontend/better/fonts/licenses/`.

## Hardening checklist

1. Set a strong `PASSWORD` if `TELEMETRY=true`, with only letters, digits and `-_.`.
2. Remove or block `results/sanitycheck.php`; limit the body of `/results/telemetry.php`.
3. Put HTTPS, HSTS and a Content-Security-Policy in front of the container.
4. Turn the route on only if you want it; set `ROUTE_TRUSTED_PROXIES` exactly; leave `ROUTE_IPV6` off without IPv6.
5. Keep the image up to date: it is rebuilt every week for the database and the PHP security patches.
