/**
 * UI/API auth: token (Bearer or HttpOnly session cookie), HTTP Basic, or
 * explicit none. One shared secret, not multi-user accounts.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, link, mkdir, open as openFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuthMode } from "../shared/api";
import { type Config, ConfigError, MIN_TOKEN_LENGTH } from "./config";

export type AuthConfig =
  | { mode: Extract<AuthMode, "token">; token: string }
  | { mode: Extract<AuthMode, "basic">; user: string; password: string }
  | { mode: Extract<AuthMode, "none"> };

export type TokenResolution = { auth: AuthConfig; tokenFileCreated: boolean };

const SESSION_COOKIE = "bravia_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/** Compare fixed-size digests so token/password length never affects timing. */
const constantTimeEqual = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));

const readCookie = (req: Request, name: string): string | null => {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
};

const cookieAttributes = (config: Pick<Config, "publicOrigin">): string => {
  const secure = config.publicOrigin?.startsWith("https://") ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict${secure}`;
};

export const sessionCookie = (config: Pick<Config, "publicOrigin">, token: string): string =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(config)}; Max-Age=${SESSION_MAX_AGE_SECONDS}`;

export const clearSessionCookie = (config: Pick<Config, "publicOrigin">): string =>
  `${SESSION_COOKIE}=; ${cookieAttributes(config)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

/** Constant-time token check shared by Bearer, cookie, and login validation. */
export const isTokenValid = (candidate: string, expected: string): boolean => constantTimeEqual(candidate, expected);

const errorCode = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && "code" in e && typeof e.code === "string" ? e.code : undefined;

const readTokenFile = async (file: string): Promise<string> => {
  await chmod(file, 0o600).catch((e) => {
    console.error("bravia: failed to restrict token file permissions:", e);
  });
  const token = (await Bun.file(file).text()).trim();
  if (token.length < MIN_TOKEN_LENGTH || /\s/.test(token))
    throw new ConfigError(
      `token file ${file} must contain at least ${MIN_TOKEN_LENGTH} non-whitespace characters; delete it to generate a new token`,
    );
  return token;
};

/** Load the persisted token, or create a random 256-bit token with mode 0600. */
export async function loadOrCreateToken(file: string): Promise<{ token: string; created: boolean }> {
  if (await Bun.file(file).exists()) return { token: await readTokenFile(file), created: false };

  const token = randomBytes(32).toString("base64url");
  await mkdir(dirname(file), { recursive: true, mode: 0o700 }).catch(() => {});
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await openFile(tmp, "wx", 0o600);
    try {
      await handle.writeFile(token);
    } finally {
      await handle.close();
    }
    await chmod(tmp, 0o600).catch((e) => {
      console.error("bravia: failed to restrict token file permissions:", e);
    });
    try {
      // Hard-link publish: the final path only ever names a fully written file,
      // and EEXIST means another instance won the race without being overwritten.
      await link(tmp, file);
    } catch (e) {
      if (errorCode(e) !== "EEXIST") throw e;
      return { token: await readTokenFile(file), created: false };
    }
    return { token, created: true };
  } catch (e) {
    throw e instanceof ConfigError ? e : new ConfigError(`cannot create token file ${file}: ${String(e)}`);
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

export async function resolveAuth(config: Config): Promise<TokenResolution> {
  if (config.authMode === "none") return { auth: { mode: "none" }, tokenFileCreated: false };
  if (config.authMode === "basic") {
    if (!config.basicPassword) throw new ConfigError("BRAVIA_BASIC_PASSWORD is required");
    return {
      auth: { mode: "basic", user: config.basicUser, password: config.basicPassword },
      tokenFileCreated: false,
    };
  }
  if (config.token) return { auth: { mode: "token", token: config.token }, tokenFileCreated: false };
  const { token, created } = await loadOrCreateToken(config.tokenFile);
  return { auth: { mode: "token", token }, tokenFileCreated: created };
}

export const isAuthorized = (req: Request, auth: AuthConfig): boolean => {
  if (auth.mode === "none") return true;
  const header = req.headers.get("authorization") ?? "";
  if (auth.mode === "token") {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match?.[1] && isTokenValid(match[1].trim(), auth.token)) return true;
    const cookie = readCookie(req, SESSION_COOKIE);
    return Boolean(cookie && isTokenValid(cookie, auth.token));
  }
  if (auth.mode === "basic") {
    const match = /^Basic\s+(\S+)$/i.exec(header);
    if (!match?.[1]) return false;
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    return constantTimeEqual(decoded, `${auth.user}:${auth.password}`);
  }
  return false;
};

export const unauthorizedResponse = (auth: AuthConfig): Response => {
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
  };
  if (auth.mode === "basic") headers["www-authenticate"] = 'Basic realm="bravia-remote", charset="UTF-8"';
  return Response.json({ ok: false, error: ["unauthorized"] }, { status: 401, headers });
};
