/**
 * Entry point: parse configuration, restore pairing credentials, wire the
 * Bravia client and start the HTTP server.
 *
 * `start` is exported so the assembly and its failure modes are testable
 * without spawning a process; the top-level block below only maps a startup
 * failure to the documented exit code.
 */
import { hostname } from "node:os";
import { type AppConfig, type AppContext, createApp } from "./app";
import { resolveAuth } from "./auth";
import { BraviaClient } from "./client";
import { ConfigError, parseConfig } from "./config";
import { CredentialStore } from "./credentials";
import { AppHistory } from "./history";
import { displayHost, isWildcardHost } from "./http";

/** Startup failure whose message is already user-facing. */
export class StartupError extends Error {}

export type Started = {
  server: Bun.Server<undefined>;
  ctx: AppContext;
};

const describe = (e: unknown): string => String(e instanceof Error ? e.message : e);

/** Assemble config, credentials, auth and the HTTP server; throws on startup failure. */
export const start = async (env: Record<string, string | undefined> = process.env): Promise<Started> => {
  const config = parseConfig(env);

  let credentials: CredentialStore;
  try {
    credentials = await CredentialStore.open(config.authFile, {
      clientId: config.clientId,
      clientIdFromEnv: config.clientIdFromEnv,
      nickname: hostname(),
      psk: config.psk,
    });
  } catch (e) {
    throw new StartupError(
      `bravia: cannot read credential file ${config.authFile} (${describe(e)}); delete it to start unpaired`,
    );
  }

  let auth: Awaited<ReturnType<typeof resolveAuth>>;
  try {
    auth = await resolveAuth(config);
  } catch (e) {
    throw new StartupError(`bravia: cannot initialize authentication (${describe(e)})`);
  }

  // Handlers get a runtime view without secrets, so they cannot leak them by
  // accident (e.g. by serializing the context); the full config stays above.
  // Explicit rather than a rest spread so a new Config field must be classified
  // here instead of silently joining the handler view.
  const appConfig: AppConfig = {
    tvUrl: config.tvUrl,
    host: config.host,
    port: config.port,
    authFile: config.authFile,
    adbPath: config.adbPath,
    timeoutMs: config.timeoutMs,
    screenTimeoutMs: config.screenTimeoutMs,
    clientId: config.clientId,
    clientIdFromEnv: config.clientIdFromEnv,
    publicOrigin: config.publicOrigin,
    authMode: config.authMode,
    tokenFile: config.tokenFile,
    basicUser: config.basicUser,
    customApps: config.customApps,
  };
  const ctx: AppContext = {
    config: appConfig,
    credentials,
    tv: new BraviaClient({ baseUrl: config.tvUrl, credentials, timeoutMs: config.timeoutMs }),
    history: new AppHistory(),
  };

  const server = Bun.serve({ port: config.port, hostname: config.host, fetch: createApp(ctx, auth.auth) });
  if (auth.auth.mode === "none")
    console.warn(
      "bravia: authentication is disabled (BRAVIA_AUTH_MODE=none) — anyone who can reach this port can control the TV.",
    );
  if (auth.auth.mode === "token" && !config.token)
    console.log(
      `bravia: UI token ${auth.tokenFileCreated ? "created at" : "loaded from"} ${config.tokenFile} — enter its contents in the web UI`,
    );
  if (isWildcardHost(config.host))
    console.warn(
      `bravia: listening on ${config.host} — the API is reachable from the network; keep authentication enabled and prefer HOST=<your LAN IP> to block DNS rebinding.`,
    );
  const tvUrl = new URL(config.tvUrl);
  const tvLabel = `${tvUrl.origin}${tvUrl.pathname === "/" ? "" : tvUrl.pathname}`;
  console.log(
    `bravia-remote → http://${displayHost(config.host)}:${server.port}  (TV: ${tvLabel}${credentials.psk ? ", PSK enabled" : ""})`,
  );
  return { server, ctx };
};

if (import.meta.main) {
  try {
    await start();
  } catch (e) {
    if (e instanceof ConfigError || e instanceof StartupError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}
