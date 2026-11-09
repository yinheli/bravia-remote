# bravia-remote

A phone/laptop-friendly web remote for Sony Bravia TVs. Bun serves the UI and proxies the
TV's Simple IP Control API: remote keys, apps, live TV info, custom buttons, and optional
network-adb screenshots. Ships as a single self-contained executable.

Requires [Bun](https://bun.sh) >= 1.4.4 (or a release binary), or Node >= 18 with the npm
launcher below, and a Bravia TV with **Settings → Network → Home Network Setup → IP
Control** enabled.

## Quick start

```sh
bun install
cp .env.example .env       # set BRAVIA_TV
bun start                  # open http://localhost:8765
```

Or run a prebuilt binary from the GitHub releases:

```sh
chmod +x ./bravia-remote-linux-x64
BRAVIA_TV=http://<tv-ip> ./bravia-remote-linux-x64
```

Or run it without cloning, from npm:

```sh
npx @yinheli/bravia-remote
# or
pnpm dlx @yinheli/bravia-remote
# or run the packaged Bun server directly, with no binary download
bunx @yinheli/bravia-remote
```

Pass the TV address inline, e.g. `BRAVIA_TV=http://192.0.2.10 npx @yinheli/bravia-remote`
(PowerShell: `$env:BRAVIA_TV="http://192.0.2.10"; npx @yinheli/bravia-remote`). Global
installs work too: `npm install -g @yinheli/bravia-remote`.

The npm package carries the server bundle for Bun plus a Node launcher. Under Node the
launcher downloads the matching GitHub release binary once, verifies it against the
release's `SHA256SUMS`, caches it under the platform cache directory
(`~/.cache/bravia-remote/` on Linux), and runs it. Override the behavior with:

- `BRAVIA_REMOTE_BINARY=/path/to/bravia-remote` — use a local binary and skip the download
- `BRAVIA_REMOTE_DOWNLOAD_BASE=https://mirror.example/bravia-remote` — fetch from a mirror
  that provides the same asset names and `SHA256SUMS`
- `BRAVIA_REMOTE_CACHE=/path/to/cache` — change the download cache location

The first start creates a login token; the server logs where it is stored. Enter it in the
UI, then pair the TV. By default the server listens on `127.0.0.1`; set `HOST` to a LAN IP
for phone access. UI text follows the browser language until you pin 中文 or English with
the language selector in the header. Names supplied by the TV (inputs, now playing) are
shown as the TV returns them, in the TV's own language.

## Use with your agent

Copy this to your agent:

```text
Set up and run bravia-remote for me.
Repository: https://github.com/yinheli/bravia-remote
If it is not checked out yet, clone that repository and work inside it.
Read AGENTS.md first.
Copy .env.example to .env; set BRAVIA_TV to <TV_IP> and HOST to <LAN_IP> or 127.0.0.1.
Start the server, then tell me the URL and how to get the login token.
Do not commit .env, .bravia_auth, or .bravia_token.
```

## Docs

- [AGENTS.md](AGENTS.md) — architecture, commands, HTTP API, tests
- [`.env.example`](.env.example) — all settings
- [SECURITY.md](SECURITY.md) — threat model and hardening
- [CONTRIBUTING.md](CONTRIBUTING.md) — contributor workflow

## License

[MIT](LICENSE). Third-party notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
