<?php

// Route page (route-better.html): off unless the administrator turns it on. See doc_docker.md (ENABLE_ROUTE).
$route_enabled = false;
// Reverse proxies whose X-Forwarded-For is trusted: IPs or CIDRs separated by commas. Empty: trust none, use REMOTE_ADDR.
$route_trusted_proxies = '';
// Trace visitors that come over IPv6 too. Only turn it on where the server itself has IPv6 (a container often has none).
$route_ipv6 = false;
