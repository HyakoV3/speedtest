# Contributing

This is a fork of [LibreSpeed](https://github.com/librespeed/speedtest). Contributions to the better pages, the route page and the
documentation are welcome as pull requests. Changes to the speed test engine itself are better sent to upstream first. For a
security problem do not open a pull request: see [SECURITY.md](SECURITY.md).

## Flow

1. Make a branch from `master`, one branch for one change.
2. Open a pull request against `master` of this fork.
3. `master` is protected: it needs an approving review and two passing checks, `review` (an automated code review) and `e2e` (the
   Playwright suite). A failure that comes from Docker Hub rate limits (HTTP 429) is not your code; re-run the job.
4. Write the pull request description in English: what changed, why, and how you checked it.

Every push to any branch, and every pull request, runs the full suite and builds the images, including for a change that only
touches documentation.

## Set up

Node.js 20 is what the CI uses (`package.json` says 14, which is too old for the Playwright version here).

```bash
npm ci
npx playwright install chromium
```

## Checks

```bash
npm run lint            # ESLint, on the upstream scripts only
npm run format:check    # Prettier, on the *.js files at the top level only
npm run test:e2e        # the Playwright suite; Docker must be running, it builds the image
npx playwright test tests/e2e/better-route.spec.js   # one spec
```

The PHP tests are plain scripts, not run by the CI; each starts with its command. For example:

```bash
docker run --rm -v "$PWD":/app -w /app php:8-apache php tests/route_test.php
```

`tests/route_parity.php` checks that the route parser of the page (`route-parse.js`) and the one in `backend/route_util.php` agree.
If you change either, run it and the `better-route-back-parse` spec.

## Rules for the better pages

- **Four languages.** Every string a visitor can see goes into `frontend/better/locales/` in `en`, `pt`, `es` and `sv`. A key missing
  in one catalog shows the English text, which is a bug to fix, not a fallback to rely on.
- **Nothing from a third party at load time.** Fonts, libraries and data are served from this repository, with their licence files.
- **No build step.** Plain scripts and CSS. Keep a module small and keep its name in line with the others in
  `frontend/better/javascript/`.
- **Style.** Prettier and ESLint are not enforced on the better pages; match the code around yours.
- **Tests with the change.** A behaviour change comes with a spec in `tests/e2e/`. Check for absence of an element by waiting for a
  settled state first, and clear anything the page stored in `localStorage` between tests.
- **Privacy.** Do not store or send more about a visitor than the feature needs. If you add something to `localStorage`, say what
  in [SECURITY.md](SECURITY.md).
- **Examples and fixtures.** Use documentation addresses (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`), not the
  addresses or hostnames of a real network.

## Do not commit

Keys, passwords, database files, your own `settings.json` or `server-list.json` changes, and notes or screenshots from your
machine. `backend/getIP_ipInfo_apikey.php` and `results/telemetry_settings.php` are tracked: keep your values out of them.

## Documentation

Write what the code does, not what it should do; if you could not check something, say so. Avoid numbers that go stale (counts of
tests, versions). When you change a variable of the Docker image, change [doc_docker.md](doc_docker.md) in the same pull request.

## Licence

Your contribution is under the licence of the repository, LGPL-3.0-or-later (see [LICENSE](LICENSE)). The companion program
[`librespeed-route`](https://github.com/HyakoV3/librespeed-route) is a separate repository, MIT OR Apache-2.0.
