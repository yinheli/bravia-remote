# AGENTS.md

Repository-specific instructions for agents. User-facing documentation lives in
[README.md](README.md); the human contributor workflow is in [CONTRIBUTING.md](CONTRIBUTING.md);
the threat model and security policy are in [SECURITY.md](SECURITY.md).

## Project shape

Bun + React single-binary remote for the Sony Bravia "Simple IP Control" API. Bun serves the
JSON API and embedded web assets; the browser is a React SPA. Tailwind CSS v4 is compiled
at build time by `scripts/build-web.ts` (Bun + `bun-plugin-tailwind`). There are no runtime
npm dependencies: React and Tailwind are build-time only. The npm package ships a Node
launcher plus a Bun server bundle; Node downloads the matching release binary once.

The route table and `AppContext` are intentionally hand-rolled for this size. Do not add
Hono/Elysia/Express or another web framework without an explicit request.

## Commands

```sh
bun install
cp .env.example .env     # set BRAVIA_TV; Bun loads .env automatically
bun run dev              # build web bundle, then --watch server
bun run test             # pretest builds public/app.js + app.css, then tests
bun run typecheck        # strict tsc, noUncheckedIndexedAccess
bun run lint             # type-aware ESLint; no explicit any
bun run check            # Biome format + lint + import order
bun run build:server     # build web bundle, then compile dist/bravia-remote
bun run build:npm        # build web bundle, then bundle dist/server.js for npm
bun run build            # alias for build:server
bun run smoke            # compiled-binary shell/auth/API check, unreachable TV
```

- `bun run test` builds the generated web bundle through `pretest`. If invoking `bun test`
  directly on a fresh clone, run `bun run build:web` first.
- CI uses Bun 1.4.4 and `bun install --frozen-lockfile`, on a pinned
  `ubuntu-26.04` runner (`ubuntu-latest` migrated to 26.04 in Nov 2026).
- `build:web` writes `public/app.js` and the Tailwind bundle `public/app.css`; `build:server`
  compiles the current platform. `build:npm` bundles the server (assets embedded) into
  `dist/server.js` for the published package.
- Cross-compile: run `bun run build:web`, then
  `bun build --compile --target=<target> src/server/main.ts --outfile <path>`. Targets:
  `bun-linux-x64`, `bun-linux-arm64`, `bun-linux-x64-musl`, `bun-darwin-x64`,
  `bun-darwin-arm64`, `bun-windows-x64`.
- Biome owns formatting/import order; ESLint owns the type-aware rules. The
  modal-autofocus and pointer-only backdrop-close a11y rules are disabled intentionally
  because dialogs have explicit Close buttons.

## Layout

```text
bin/
  bravia-remote.mjs  npm entry point (bin `bravia-remote`)
  launcher.mjs       Bun fast path, release-binary download + SHA256SUMS cache
  launcher.test.mjs
src/
  shared/     typed boundary parsers and wire types (Bravia RPC, HTTP API)
    parse.ts      the minimal `isRecord` JSON-object guard
    bravia.ts     TV RPC envelopes + typed result parsers
    api.ts        HTTP response types + parsers
  server/
    main.ts        entry point (config -> auth -> credentials -> Bun.serve)
    config.ts      env parsing (Config type, fails fast with hints)
    auth.ts        token/Basic/none guard + generated token file
    credentials.ts pairing state + persistence
    client.ts      BraviaClient: JSON-RPC, IRCC SOAP, pairing flows
    history.ts     MRU app history ("previous app")
    app.ts         route table + static assets + 404
    requests.ts    typed request-body parsers
    routes/        status, auth, pair, key, apps, screen handlers
    assets.ts      embedded index.html / app.css / app.js / favicon.svg (text imports)
  web/
    app.tsx        browser entry
    app.css        Tailwind entry: theme tokens + base page styles
    classes.ts     shared utility strings for keys, buttons, sheets, inputs
    AuthGate.tsx   token prompt + auth check before the app loads
    gate.ts        AuthGate state machine (pure reducer)
    AppShell.tsx   header, status poll, keyboard bindings
    pairing.ts     PairDialog state machine (pure reducer)
    paired.ts      header paired badge: dialog writes outrank in-flight poll results
    poll.ts        AppShell poll plan: per-tick fetches, success latching, non-overlapping loop
    keys.ts        standard IRCC codes + pure keyboard mapping
    focus.ts       dialog focus contract: initial focus, Tab trap, focus restore
    parse.ts       /api/info -> view models, error text
    api.ts         typed fetch wrappers (server codes localized here)
    i18n.ts        zh/en dictionaries + language preference (localStorage; browser detection by default)
    components/    Remote, PairDialog, InfoPanel, HelpDialog
  test-support/    shared test helpers (temp-dir lifecycle)
scripts/
  build-web.ts     Bun.build + Tailwind -> public/app.js + public/app.css
  smoke.ts         black-box smoke test for the compiled binary
```

Tests live next to the code as `*.test.ts`; the plain-JS npm launcher uses `*.test.mjs`.

## HTTP API

This table mirrors `ROUTE_MANIFEST` in `src/server/app.ts`; `src/server/app.test.ts` fails
if the two drift apart.

| Route         | Method | Purpose                                                                                                             |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `/api/auth`   | GET    | `{ ok: true, mode }`; requires the configured credential                                                            |
| `/api/auth`   | POST   | `{token}` login; sets the HttpOnly session cookie                                                                   |
| `/api/auth`   | DELETE | Logout; expires the session cookie                                                                                  |
| `/api/status` | GET    | Raw power status                                                                                                    |
| `/api/codes`  | GET    | Remote key names + IRCC codes from the TV                                                                           |
| `/api/info`   | GET    | Aggregated TV info for the info panel                                                                               |
| `/api/pair`   | GET    | Pairing status (`{ nickname, clientid, paired }`)                                                                   |
| `/api/pair`   | POST   | `{}` bootstrap (may pop the PIN) · `{key}` confirm · `{psk}` verify · `{nickname}` set device name (then bootstrap) |
| `/api/key`    | POST   | `{code}` send one IRCC key                                                                                          |
| `/api/app`    | POST   | `{uri}` launch · `{back:true}` previous app                                                                         |
| `/api/config` | GET    | `{ apps }` custom buttons (from `BRAVIA_APPS`)                                                                      |
| `/api/screen` | GET    | PNG screenshot (requires adb)                                                                                       |

API requests require the configured credential: the browser sends its HttpOnly session
cookie (or an API client can send `Authorization: Bearer <token>`) in token mode, or HTTP
Basic in basic mode. `BRAVIA_AUTH_MODE=none` disables this check.
Error responses are language-neutral codes; the web UI localizes them:

- string app codes: `"auth"` (PSK rejected), `"none"` (no previous app), `"bad"` (malformed
  request), `"forbidden"` (cross-origin write or cross-site screenshot blocked),
  `"unknown"`
- numeric TV protocol codes pass through verbatim (e.g. `40005` standby, `401`/`403` auth)
- `/api/screen` failures use `"timeout"`, `"too-small"` (with `bytes`), `"adb-missing"`,
  `"screencap-failed"`, or the raw error text
- `/api/codes` returns a bare array on success and `{ error: [...] }` on an RPC failure
  (or `{ error: ["unknown", …] }` for a malformed result), so an empty list is not a
  failure signal
- The `/api/screen` client parser also accepts the central guards'
  `{ ok: false, error: ["forbidden"] }` shape and normalizes it to the string-code form

## Parsing boundaries

- All untrusted JSON is parsed at the edge. `src/shared/parse.ts` contains only `isRecord`;
  do not add generic record accessors back into domain code.
- TV RPC results: `src/shared/bravia.ts`. HTTP wire responses: `src/shared/api.ts`.
  Request bodies: `src/server/requests.ts`. Persisted credentials: `credentials.ts`.
- `BraviaClient.rpc` returns the raw RPC envelope because Sony result shapes vary per
  method; each route/client parser narrows `result[0]` into a domain type.
- Keep the `readJsonBody` content-type and 64 KiB body-cap checks.

## Styling

- Tailwind CSS v4 is the styling layer. Utilities live in the TSX; shared strings for the
  repeated key/button/sheet/input styles live in `src/web/classes.ts`.
- `src/web/app.css` holds only the Tailwind import, theme tokens (`@theme`), and base page
  styles. `public/app.css` is generated by `scripts/build-web.ts`; edit the source, never
  the bundle.
- Keep class names literal, including in `classes.ts`, so Tailwind's scanner can see them;
  do not compose class names dynamically.
- `biome.json` enables `css.parser.tailwindDirectives` so Biome can parse the `@theme`
  block.

## State machines

Transient state is modeled with discriminated unions and pure reducers where the
combination space is non-trivial. Do not add a state-machine library; the machines here
are small enough that a framework would hurt DX and AX.

| Machine            | Source                                 | Notes                                                                                                                                                                                                                                                                      |
| ------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pairing dialog     | `src/web/pairing.ts`                   | `idle → awaitingPin → succeeded/failed`; one request slot; mode/input edits are ignored while a request is in flight; outcomes (`ok`/`needKey`/`fail`) are the only exits.                                                                                                 |
| Auth gate          | `src/web/gate.ts`                      | `checking → token/authenticating/unreachable → ready`; a server-auth 401 moves `ready` back to `token` with an expiry message. The component only runs the request named by the state and returns one result event.                                                        |
| Overlay precedence | `src/web/keys.ts` (`resolveKeyAction`) | Pure precedence: help > pairing > screenshot lightbox > info > global shortcuts. The caller owns `preventDefault` and repeat throttling.                                                                                                                                   |
| App polling        | `src/web/poll.ts`                      | `runPoll` fetches status/pair first, then config, then IRCC codes; an empty config success latches, failures retry. `startPollLoop` schedules the next 6 s tick only after the previous one settles; stop cancels it. Toast/flash timers remain latest-wins in `AppShell`. |
| Screenshot capture | `src/server/routes/screen.ts`          | Per-`AppContext` coalescing slot: concurrent callers share one adb run, separate app instances never do. Each caller gets its own `Response`.                                                                                                                              |
| MRU app history    | `src/server/history.ts`                | Capped MRU; `peekBack` is read-only and the reorder happens only after the TV accepts the switch.                                                                                                                                                                          |

The server does **not** own a pending-PIN state machine: the TV owns that state.
`CredentialStore` only records durable credentials (`basic`/PSK) after a confirmed
registration or PSK probe, and serializes writes. A persisted `clientid` is reused unless
`BRAVIA_CLIENT_ID` is explicitly set. The info panel's load/screenshot/zoom
state is linear and intentionally local; a reducer there would add indirection without
removing a real invalid state.

## Auth and security invariants

- Default auth mode is `token`: `Authorization: Bearer <token>` or the `bravia_session`
  HttpOnly cookie. `basic` is HTTP Basic; `none` is an explicit trusted-deployment opt-out.
- Token mode leaves the static shell public so it can render the login gate; all `/api/*`
  requests require a credential. Basic mode protects static assets and API.
- Do not weaken the Host/DNS-rebinding guard, Origin/CSRF guard, or the cross-site
  screenshot (`Sec-Fetch-Site`) check. Keep the ordering: Host guard -> auth ->
  Origin/screenshot checks.
- Screenshot captures coalesce into one adb run; every caller must get its own `Response`.
- Never log or commit tokens, PSKs, cookies, `.env`, `.bravia_auth`, `.bravia_token`, or
  `.local/`. Tests and examples use `192.0.2.x`, never a real TV or LAN address.
- `BRAVIA_PUBLIC_ORIGIN` is only for HTTPS reverse-proxy deployments; keep cookie `Secure`
  tied to an HTTPS public origin.

## Tests

- Integration tests drive the real handlers against the mock TV in
  `src/server/routes.test.ts`; screenshots use a fake `adb` shell script. No real device.
- Test files run under POSIX shell assumptions; Windows contributors should use WSL or a
  Linux/macOS environment.
- The npm launcher's platform mapping, checksum parsing, download/cache path, and
  `BRAVIA_REMOTE_BINARY` override are covered by `bin/launcher.test.mjs`; its HTTP tests use
  a local server, never GitHub.
- Add behavior-level tests for parser, auth, cookie, and CSRF changes; keep zh/en i18n keys
  and placeholders in sync (tests enforce parity).

## Generated files

`public/app.js` and `public/app.css` are generated and ignored, along with `dist/`,
`vendor/`, and `node_modules/`. `dist/server.js` is the npm package's Bun bundle, produced
by `build:npm` (`prepack` runs it before `npm publish`). Do not commit generated assets.
`public/index.html` is tracked; the stylesheet source is `src/web/app.css`. Asset
headers/CSP live in `src/server/app.ts` and the HTML file.

## Release

Pushing a `v*` tag runs the release workflow. Its check job runs tests and verifies the tag
matches `package.json`; the build job cross-compiles all six targets, smoke-tests the
linux-x64 binary (the only target that can run on the Linux runner), and attaches binaries
plus `LICENSE`, `THIRD_PARTY_NOTICES.md`, `BUN-LICENSE.md`, and `SHA256SUMS`. The final
publish job then runs `npm publish --access public` for `@yinheli/bravia-remote` through
npm trusted publishing over GitHub OIDC (`id-token: write`, npm >= 11.5.1 from Node 24; no
token secret). Provenance is generated automatically. Configure the trusted publisher on
npmjs.com for `yinheli/bravia-remote`, workflow `release.yml`, no environment, and enable
direct `npm publish` (configurations created after 2026-09-03 default to staged publishing
only). Trusted publishing requires an existing package: publish the first version manually,
configure the publisher, then let CI own later versions; a new configuration expires if its
first publish does not succeed within two days. Actions use major version tags
(e.g. `actions/checkout@v7`) and are updated by Dependabot.

## Related docs

When changing routes, config, auth, or user-visible behavior, update the corresponding
README section, `.env.example`, `CONTRIBUTING.md`, and this file as needed so they do not
drift.
