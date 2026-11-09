# Contributing

Thanks for improving `bravia-remote`. Bug reports, documentation fixes, and focused pull
requests are welcome.

## Prerequisites

- [Bun](https://bun.sh) >= 1.4.4 (the version used by CI)
- A Bravia TV is **not** required for development or tests; the test suite runs against a
  local mock TV and a fake `adb`
- On Windows, the test suite needs a POSIX shell for its fake `adb` fixtures; run the
  checks under WSL or a Linux/macOS environment

## Setup

```sh
bun install
cp .env.example .env     # set BRAVIA_TV; Bun loads .env automatically
bun run dev
```

`bun run dev` builds the web bundle and starts the server with `--watch`. Set
`BRAVIA_TV=http://<tv-ip>` to point at a real TV; otherwise use the mock test path.

## Checks

Run these before opening a pull request:

```sh
bun run typecheck
bun run lint
bun run check
bun run test
```

`bun run test` runs `build:web` first because the server imports the generated
`public/app.js` and `public/app.css`. If you invoke `bun test` directly, run
`bun run build:web` first on a fresh clone.

`bun run build:server` builds the web bundle itself before compiling, so it works on a
fresh clone and never embeds a stale UI. `bun run smoke [path-to-binary]` starts the
compiled binary with an isolated temp config and an unreachable TV, then checks the public
shell plus the authenticated API surface. CI runs it after `build:server` and on the
Linux release artifact; keep that path working.

`bun run build:npm` produces `dist/server.js`, the Bun bundle shipped by the npm package
(`@yinheli/bravia-remote`); `prepack` runs it automatically before `npm publish`. The Node
launcher in `bin/` is plain JavaScript and is exercised by `bin/launcher.test.mjs`.

## Code conventions

Repository architecture, commands, and agent-specific constraints are in
[AGENTS.md](AGENTS.md). Human contributor expectations remain here.

- TypeScript is strict, with `noUncheckedIndexedAccess`. Do not introduce `any`; parse
  untrusted JSON at the boundary with the typed parsers in `src/shared/bravia.ts`,
  `src/shared/api.ts`, and `src/server/requests.ts`. Keep generic record access out of
  domain code.
- Biome owns formatting, import order, and the fast lint pass. ESLint owns the type-aware
  rules. Apply fixes with `bun run check:fix` and `bun run lint:fix`.
- Keep server and web layers separated: the browser holds no TV credentials, and all TV
  authentication stays in `src/server`.
- The Chinese and English dictionaries in `src/web/i18n.ts` must stay in sync; tests
  enforce identical keys and placeholders.
- Do not commit generated assets: `public/app.js`, `public/app.css`, `dist/`, and `vendor/`
  are ignored.
- Styles are Tailwind CSS v4 utilities in the TSX. Shared class strings live in
  `src/web/classes.ts`; theme tokens and base styles live in `src/web/app.css`. Edit the
  source, not the generated `public/app.css`.

## Tests

Add tests next to the code as `*.test.ts`; the plain-JS npm launcher uses `*.test.mjs`.
Prefer behavior-level tests over implementation snapshots:

- Server routes: drive `createApp` against the mock TV used by `src/server/routes.test.ts`.
- Client and pairing flows: inject a fake `fetch` instead of contacting a device.
- Screenshots: use a fake executable, as in `src/server/routes/screen.test.ts`.
- npm launcher: cover target mapping, checksums, and the download cache with a local HTTP
  server; never hit GitHub in tests.
- Security guards: cover cross-origin writes, foreign `Host` headers, and cross-site
  screenshot loads when touching `src/server/http.ts`.

Never use a real TV, real credentials, or real LAN addresses in tests or fixtures.

## Secrets and privacy

- Never commit `.bravia_auth`, `.bravia_token`, `.local/`, a real PSK, a registration
  cookie, an access token, or a screenshot from a real TV.
- Use documentation addresses such as `192.0.2.10` in examples and tests.
- If you discover a vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a
  public issue with exploit details.

## Pull requests

- Keep changes focused; split unrelated refactors into separate PRs.
- Explain the user-visible behavior, the approach, and the verification you ran.
- Update the docs that own the surface you changed: `AGENTS.md` (architecture and the
  HTTP API table), `.env.example` (configuration), `src/web/i18n.ts` in both languages
  (user-facing text), and `README.md` (setup workflow).
- Add or update tests for behavioral changes.
- Contributions are accepted under the repository's MIT license.
