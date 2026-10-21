# Running the route page

`route-better.html` shows the path from your server to the visitor: each router, the time to it, its network (AS) and approximate
country, and the path MTU. The visitor can also paste the route their own device makes to the server (the way back) and see both
on one map. This page is for the person who runs the server. What the visitor sees is described in
[frontend/better/README.md](../frontend/better/README.md); how it is built is in [ARCHITECTURE.md](../ARCHITECTURE.md); the risks
are in [SECURITY.md](../SECURITY.md).

The route page is **off by default**. When it is on, a request from the internet makes your server run `traceroute`.

## What it needs

- PHP 8.2 or newer with `proc_open`, and `/usr/bin/traceroute` executable. On Debian this is the "modern" `traceroute` package
  (it has `--mtu`); on Alpine it is the `traceroute` package, not the busybox applet. The Docker images already have it.
- No extra privilege: it sends UDP probes only. Where the container's own interface has an MTU above 1500, the page shows the MTU as
  unknown.
- `backend/country_asn.mmdb` (in the repository) for the network and country of each router.

## Turning it on

**Docker** (standalone or dual mode only):

```shell
docker run -p 80:8080 -e ENABLE_ROUTE=true ghcr.io/hyakov3/speedtest
```

The variables are in [doc_docker.md](../doc_docker.md): `ENABLE_ROUTE`, `ROUTE_TRUSTED_PROXIES`, `ROUTE_IPV6`, `ROUTE_CLI_URL`.
The link "Route" then shows in the footer of the other two better pages.

**Without Docker:** set `$route_enabled = true;` in `backend/route_settings.php`, install `traceroute`, and show the link by removing
`hidden` from `<a id="routeLink">` in the better pages.

## Behind a reverse proxy (important)

The server traces the address it believes is the visitor's. Without help that is the address of the connection, which behind a
proxy is the proxy.

- Set `ROUTE_TRUSTED_PROXIES` to the addresses or CIDR ranges of **your** proxies, for example `172.18.0.0/16` for the Docker network.
  Then `X-Forwarded-For` is read, **from the right**, only when the connection comes from one of them.
- Never list a range that clients can reach directly: they could then choose the address to trace.
- Only `X-Forwarded-For` is read, from the right, and the first address that is not one of your proxies is taken; an invalid item gives `no_client_ip`. A proxy that does not add it gives the error `no_client_ip`. `Forwarded`, `X-Real-IP` and
  `Client-IP` are ignored on purpose.
- If you do not list the proxy: on a private network every visitor looks private and the page says there is no internet route to
  show; behind a public proxy or a CDN the route is traced to the edge of that proxy, not to the visitor.
- Check it with a visitor from outside: the first routers should be on your server's side and the last one near the visitor.

## IPv6

`ROUTE_IPV6=true` (`$route_ipv6 = true;`) traces visitors that come over IPv6 with `traceroute -6`. Turn it on only where the
server itself has IPv6, otherwise the route of an IPv6 visitor shows no hops.

## Limits

| Limit | Value | Where |
| ----- | ----- | ----- |
| Routes per visitor | 1 a minute (per whole address; IPv6 is not grouped by prefix) | `backend/route.php` |
| Routes for the whole server | 60 an hour | `backend/route.php` |
| At the same time | 2 | `backend/route.php` |
| Time of one route | 15 seconds | `backend/route.php` |
| Output of `traceroute` read | 16 KB (`route.php` reads no request body) | `backend/route.php` |
| Body of a pasted-route lookup | 8 KB | `backend/route_enrich.php` |
| Pasted-route lookups per visitor | 1 every 5 seconds, 120 an hour | `backend/route_enrich.php` |
| Pasted-route lookups for the whole server | 3600 an hour | `backend/route_enrich.php` |

The 60 an hour are shared: one client that keeps asking can use them all. If that matters to you, limit `/backend/route.php` in
the reverse proxy too.

## What is kept on the server

A keyed hash of the visitor's address and the times of the requests, in `<temp dir>/librespeed-route` (`/tmp/librespeed-route` in
the image). The key is a random secret that is renewed at the next request once it is more than 24 hours old. The per-visitor files are deleted on the next request after their window
(one minute for the route, one hour for the lookups), not by a timer; the secret, the hourly counter and a few other shared files stay and are overwritten. The hash is a pseudonym: whoever can read the folder can test
addresses against it. The address of the visitor and the routers are not written. The route history lives in the visitor's browser only.

On a host with other users create the folder yourself (mode `0700`, owned by the web server user) or use a private temp dir for the
web server (systemd `PrivateTmp=yes`).

## The way back

The page cannot trace the route from the visitor to the server (a browser has no way to), so the visitor does it on their own device:

1. paste the output of `tracert`, `traceroute`, `tracepath` or `mtr` (the page shows the right command for the system), or
2. use [`librespeed-route`](https://github.com/HyakoV3/librespeed-route), a small program that runs it for them, alone or with its
   browser extension and the button on the page.

For a pasted route the page sends the **public** addresses of the routers to `backend/route_enrich.php`, which only reads the offline
database. `ROUTE_CLI_URL` is the address of the page that offers the program; set it empty to remove the offer.
The parser is tested against the sample outputs in `tests/fixtures/route-back/`. Some are real, some were written by hand from the
documented format; `tracert` on Windows is the least checked.

## Tests

`tests/route_test.php`, `tests/route_enrich_http_test.php` and `tests/route_parity.php` are plain PHP files; each starts with the
command to run it. They are not run by the CI. The page is covered by the `better-route-*.spec.js` Playwright specs.
