# Security Policy

## Supported versions

`bravia-remote` is pre-1.0. Security fixes land on the latest release and the default
branch; older tagged releases are not backported.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:

<https://github.com/yinheli/bravia-remote/security/advisories/new>

If that form is unavailable, open a minimal public issue asking for a private channel
without describing the exploit. Do not include TV credentials, PSKs, cookies,
screenshots, or LAN addresses in a public issue.

Include the affected version or commit, deployment mode (`HOST` value), platform, a
reproduction, and the impact you observed. We aim to acknowledge reports within seven
days and will coordinate disclosure after a fix is available.

## Threat model

This is a local-network appliance controller, not a multi-user service:

- Authentication is a **single shared secret**, not per-user accounts. `BRAVIA_AUTH_MODE`
  defaults to `token`; `basic` and explicit `none` are available. Anyone with the token or
  Basic password can send keys, launch apps, read TV information, and request screenshots.
  In token mode the browser exchanges the token for an `HttpOnly`, `SameSite=Strict`
  session cookie (`Secure` when `BRAVIA_PUBLIC_ORIGIN` is HTTPS); the token is not
  persisted in JavaScript-accessible storage. API clients may send
  `Authorization: Bearer <token>` directly.
- The default `HOST=127.0.0.1` limits reach to the local machine. Keeping the loopback
  default is the primary network control.
- `HOST=0.0.0.0` exposes the remote to every host on the LAN. Prefer `HOST=<your LAN IP>`
  when LAN access is required. Authentication still applies, but `BRAVIA_AUTH_MODE=none`
  combined with a wildcard bind leaves the API open to the network and to DNS rebinding.
- Pairing authenticates this server to the TV; it is **separate** from the web token/Basic
  authentication. Pairing credentials (TV Basic credential, cookie, and PSK) are stored in
  the auth file. The server creates it with owner-only permissions (`0600`). The generated
  UI token lives in `BRAVIA_TOKEN_FILE` with the same permissions. Neither file should be
  committed or shared.
- `/api/screen` can expose whatever is on the TV display. Cross-site browser loads are
  rejected, but any authenticated client can request a capture.
- The server does not terminate TLS. Do not expose it directly to the internet; use a
  VPN or an authenticated reverse proxy if remote access is unavoidable. When a proxy
  terminates TLS, set `BRAVIA_PUBLIC_ORIGIN` to the public origin so browser writes are
  accepted; the proxy must still forward the request to the loopback listener.
- The token, session cookie, and Basic password protect the web UI, but plain HTTP sends
  them across the LAN in cleartext. Use a trusted network or terminate TLS at a reverse
  proxy; with HTTPS termination set `BRAVIA_PUBLIC_ORIGIN` so the cookie gets `Secure`.
- The TV leg uses the scheme in `BRAVIA_TV`. Plain `http://` sends the TV Basic credential,
  cookie, and PSK across the LAN in cleartext; use only a trusted network or a TV endpoint
  that supports HTTPS. TV redirects are not followed, so credentials are never replayed to
  a different location.
- Network adb is powerful and often unauthenticated on the TV side. Enabling it opens the
  TV's debug bridge on TCP 5555 to the LAN, where any reachable host may be able to run
  commands, install apps, or read data. Disable TV debugging when screenshots are not
  needed, and keep the TV on a trusted VLAN when it is enabled.

Out of scope: compromise of the TV, the LAN, the host OS, or adb itself; attacks that
already require local code execution; and the documented consequences of deliberately
binding to a wildcard address.

## Hardening checklist

- Keep the default `127.0.0.1` binding unless you need LAN access.
- Prefer `HOST=<LAN IP>` over `0.0.0.0`, and never port-forward the service.
- Keep `BRAVIA_AUTH_MODE=token` (the default) or `basic`. Use `none` only on a trusted
  localhost/LAN deployment; the server logs a warning when it is disabled.
- Set `BRAVIA_TOKEN` if you need a stable token across hosts, or keep the generated
  `.bravia_token` file at `0600`. Pinned and file tokens must be at least 4 non-whitespace
  characters; use a long random value when the port is reachable beyond localhost.
- Keep the auth file at `0600`; delete it to unpair.
- Use a PSK or normal-mode pairing instead of leaving the TV open.
- Run as an unprivileged user and keep Bun and dependencies up to date.
- Review [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistributing binaries.
