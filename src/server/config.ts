/** Environment-driven configuration; see the README for the variable reference. */
import { dirname } from "node:path";
import type { AuthMode } from "../shared/api";
import { APP_URI_PATTERN, type CustomApp, isAppUri } from "../shared/apps";

/** Minimum accepted length for a pinned or persisted UI token. */
export const MIN_TOKEN_LENGTH = 4;

export type Config = {
  /** Base URL of the TV, e.g. http://192.0.2.10 */
  tvUrl: string;
  /** HTTP listen address (default: loopback only; set HOST=0.0.0.0 for LAN access) */
  host: string;
  port: number;
  /** Credential file written after pairing */
  authFile: string;
  /** adb binary used for network-adb screenshots */
  adbPath: string;
  /** Per-request timeout for TV RPC calls */
  timeoutMs: number;
  /** adb screenshot phase timeout */
  screenTimeoutMs: number;
  /** Client id presented to the TV during pairing (default: bravia-remote) */
  clientId: string;
  /** True when BRAVIA_CLIENT_ID was set; it then overrides the persisted client id */
  clientIdFromEnv: boolean;
  /** Public HTTPS origin when the server sits behind a TLS reverse proxy */
  publicOrigin: string | null;
  /** UI/API authentication mode (default: token) */
  authMode: AuthMode;
  /** Token from the environment; when absent, tokenFile is generated/loaded */
  token: string | null;
  /** Persisted token file used when authMode=token and no token env is set */
  tokenFile: string;
  /** HTTP Basic username used when authMode=basic */
  basicUser: string;
  /** HTTP Basic password used when authMode=basic */
  basicPassword: string | null;
  /** Pre-shared key (env wins over the value stored in the auth file) */
  psk: string | null;
  /** Extra app-launch buttons rendered by the web UI (BRAVIA_APPS) */
  customApps: CustomApp[];
};

export class ConfigError extends Error {}

const required = (env: Record<string, string | undefined>, key: string, hint: string): string => {
  const v = env[key]?.trim();
  if (!v) throw new ConfigError(`${key} is required. ${hint}`);
  return v;
};

const intEnv = (env: Record<string, string | undefined>, key: string, fallback: number): number => {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ConfigError(`${key} must be a positive integer, got "${raw}"`);
  return n;
};

/** BRAVIA_APPS format: comma-separated `Name=uri` pairs, e.g. "Bilibili=com.sony.dtv.…" */
const parseCustomApps = (raw: string | undefined): CustomApp[] => {
  if (!raw?.trim()) return [];
  return raw.split(",").map((part): CustomApp => {
    const eq = part.indexOf("=");
    const name = eq === -1 ? "" : part.slice(0, eq).trim();
    const uri = (eq === -1 ? "" : part.slice(eq + 1)).trim();
    if (!name || !isAppUri(uri))
      throw new ConfigError(
        `BRAVIA_APPS entry "${part.trim()}" is invalid; expected "Name=uri" where uri matches ${APP_URI_PATTERN}`,
      );
    return { name, uri };
  });
};

const defaultAuthFile = (env: Record<string, string | undefined>): string => {
  const home = (env.HOME ?? env.USERPROFILE ?? ".").replace(/\/+$/, "");
  const configHome = env.XDG_CONFIG_HOME?.trim() || `${home}/.config`;
  return `${configHome}/bravia-remote/auth.json`;
};

export function parseConfig(env: Record<string, string | undefined> = process.env): Config {
  const tvUrl = required(env, "BRAVIA_TV", "Set it to your TV base URL, e.g. BRAVIA_TV=http://192.0.2.10");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(tvUrl);
  } catch {
    throw new ConfigError(`BRAVIA_TV "${tvUrl}" is not a valid URL, e.g. http://192.0.2.10`);
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")
    throw new ConfigError(`BRAVIA_TV must use http(s), got "${tvUrl}"`);

  const port = intEnv(env, "PORT", 8765);
  if (port > 65535) throw new ConfigError(`PORT must be <= 65535, got "${port}"`);
  const timeoutMs = intEnv(env, "BRAVIA_TIMEOUT_MS", 4000);
  const screenTimeoutMs = intEnv(env, "BRAVIA_SCREEN_TIMEOUT_MS", 9000);
  const maxTimerMs = 2_147_483_647;
  if (timeoutMs > maxTimerMs) throw new ConfigError(`BRAVIA_TIMEOUT_MS must be <= ${maxTimerMs}`);
  if (screenTimeoutMs > maxTimerMs) throw new ConfigError(`BRAVIA_SCREEN_TIMEOUT_MS must be <= ${maxTimerMs}`);

  const rawAuthMode = env.BRAVIA_AUTH_MODE?.trim().toLowerCase() || "token";
  if (rawAuthMode !== "token" && rawAuthMode !== "basic" && rawAuthMode !== "none")
    throw new ConfigError(`BRAVIA_AUTH_MODE must be token, basic, or none, got "${rawAuthMode}"`);
  const authMode: AuthMode = rawAuthMode;

  const token = env.BRAVIA_TOKEN?.trim() || null;
  if (token && (token.length < MIN_TOKEN_LENGTH || /\s/.test(token)))
    throw new ConfigError(`BRAVIA_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters with no whitespace`);

  const basicUser = env.BRAVIA_BASIC_USER?.trim() || "admin";
  const basicPassword = env.BRAVIA_BASIC_PASSWORD || null;
  if (authMode === "basic" && (!basicPassword || basicPassword.length < 8))
    throw new ConfigError("BRAVIA_BASIC_PASSWORD must be at least 8 characters when BRAVIA_AUTH_MODE=basic");

  const authFile = env.BRAVIA_AUTH_FILE?.trim() || defaultAuthFile(env);
  const tokenFile = env.BRAVIA_TOKEN_FILE?.trim() || `${dirname(authFile)}/.bravia_token`;
  const clientIdOverride = env.BRAVIA_CLIENT_ID?.trim() || null;

  const rawPublicOrigin = env.BRAVIA_PUBLIC_ORIGIN?.trim();
  let publicOrigin: string | null = null;
  if (rawPublicOrigin) {
    let parsed: URL;
    try {
      parsed = new URL(rawPublicOrigin);
    } catch {
      throw new ConfigError(`BRAVIA_PUBLIC_ORIGIN "${rawPublicOrigin}" is not a valid origin`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new ConfigError(`BRAVIA_PUBLIC_ORIGIN must use http(s), got "${rawPublicOrigin}"`);
    if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password)
      throw new ConfigError(`BRAVIA_PUBLIC_ORIGIN must be an origin, e.g. https://remote.example.com`);
    publicOrigin = parsed.origin;
  }

  return {
    tvUrl: tvUrl.replace(/\/+$/, ""),
    host: env.HOST?.trim() || "127.0.0.1",
    port,
    authFile,
    adbPath: env.BRAVIA_ADB?.trim() || "adb",
    timeoutMs,
    screenTimeoutMs,
    clientId: clientIdOverride ?? "bravia-remote",
    clientIdFromEnv: clientIdOverride !== null,
    publicOrigin,
    authMode,
    token,
    tokenFile,
    basicUser,
    basicPassword,
    psk: env.BRAVIA_PSK?.trim() || null,
    customApps: parseCustomApps(env.BRAVIA_APPS),
  };
}
