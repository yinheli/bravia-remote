import { afterEach, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { cleanupTempDirs, tempDir } from "../test-support/temp";
import {
  clearSessionCookie,
  isAuthorized,
  isTokenValid,
  loadOrCreateToken,
  resolveAuth,
  sessionCookie,
  unauthorizedResponse,
} from "./auth";
import { parseConfig } from "./config";

afterEach(cleanupTempDirs);

const req = (authorization?: string): Request =>
  new Request("http://app.test/", { headers: authorization ? { authorization } : {} });

describe("auth guard", () => {
  test("token mode accepts only the exact bearer token", () => {
    const auth = { mode: "token", token: "0123456789abcdef0123456789abcdef" } as const;
    expect(isAuthorized(req(`Bearer ${auth.token}`), auth)).toBe(true);
    expect(isAuthorized(req("Bearer wrong"), auth)).toBe(false);
    expect(isAuthorized(req(), auth)).toBe(false);
    const denied = unauthorizedResponse(auth);
    expect(denied.headers.get("www-authenticate")).toBeNull();
    expect(denied.headers.get("x-frame-options")).toBe("DENY");
  });

  test("token mode accepts an HttpOnly cookie and adds Secure behind HTTPS", () => {
    const token = "0123456789abcdef0123456789abcdef";
    const auth = { mode: "token", token } as const;
    const config = parseConfig({ BRAVIA_TV: "http://tv" });
    const setCookie = sessionCookie(config, token);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain("Secure");
    const cookie = setCookie.split(";")[0] ?? "";
    expect(isAuthorized(new Request("http://app.test/", { headers: { cookie } }), auth)).toBe(true);

    const secure = parseConfig({ BRAVIA_TV: "http://tv", BRAVIA_PUBLIC_ORIGIN: "https://remote.example.com" });
    expect(sessionCookie(secure, token)).toContain("; Secure");
    expect(clearSessionCookie(secure)).toContain("Max-Age=0");
    expect(isTokenValid(token, token)).toBe(true);
    expect(isTokenValid("wrong", token)).toBe(false);
  });

  test("basic mode checks the decoded credential", () => {
    const auth = { mode: "basic", user: "admin", password: "s3cret123" } as const;
    const header = `Basic ${Buffer.from("admin:s3cret123").toString("base64")}`;
    expect(isAuthorized(req(header), auth)).toBe(true);
    expect(isAuthorized(req(`Basic ${Buffer.from("admin:wrong").toString("base64")}`), auth)).toBe(false);
    expect(unauthorizedResponse(auth).headers.get("www-authenticate")).toContain("Basic");
  });

  test("none mode bypasses auth", () => {
    expect(isAuthorized(req(), { mode: "none" })).toBe(true);
  });
});

describe("token file", () => {
  test("creates a 0600 token and reuses it", async () => {
    if (process.platform === "win32") return; // POSIX perms not applicable
    const file = `${await tempDir("bravia-token-")}/.bravia_token`;
    const first = await loadOrCreateToken(file);
    expect(first.created).toBe(true);
    expect(first.token.length).toBeGreaterThanOrEqual(32);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).toBe(first.token);
    const second = await loadOrCreateToken(file);
    expect(second.created).toBe(false);
    expect(second.token).toBe(first.token);
  });

  test("concurrent first starts share one token", async () => {
    if (process.platform === "win32") return; // POSIX perms not applicable
    const file = `${await tempDir("bravia-token-")}/.bravia_token`;
    const results = await Promise.all([
      loadOrCreateToken(file),
      loadOrCreateToken(file),
      loadOrCreateToken(file),
      loadOrCreateToken(file),
    ]);
    expect(new Set(results.map((r) => r.token)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const contents = await readFile(file, "utf8");
    expect(results.every((r) => r.token === contents)).toBe(true);
  });

  test("accepts a four-character token file", async () => {
    const file = `${await tempDir("bravia-token-")}/.bravia_token`;
    await Bun.write(file, "abcd");
    const { token, created } = await loadOrCreateToken(file);
    expect(created).toBe(false);
    expect(token).toBe("abcd");
  });

  test("refuses an empty token file with a recovery hint", async () => {
    const file = `${await tempDir("bravia-token-")}/.bravia_token`;
    await Bun.write(file, "");
    const error = await loadOrCreateToken(file).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(file);
    expect(String(error)).toMatch(/delete it to generate a new token/);
  });

  test("refuses a corrupt token file", async () => {
    const file = `${await tempDir("bravia-token-")}/.bravia_token`;
    await Bun.write(file, "abc");
    let error: unknown;
    try {
      await loadOrCreateToken(file);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/at least 4/);
    expect(String(error)).toMatch(/delete it to generate a new token/);
  });
});

describe("resolveAuth", () => {
  test("defaults to token mode and uses BRAVIA_TOKEN when provided", async () => {
    const token = "0123456789abcdef0123456789abcdef";
    const config = parseConfig({ BRAVIA_TV: "http://tv", BRAVIA_TOKEN: token });
    expect(config.authMode).toBe("token");
    expect((await resolveAuth(config)).auth).toEqual({ mode: "token", token });
  });

  test("supports basic and explicit none", async () => {
    const basic = parseConfig({
      BRAVIA_TV: "http://tv",
      BRAVIA_AUTH_MODE: "basic",
      BRAVIA_BASIC_USER: "u",
      BRAVIA_BASIC_PASSWORD: "password123",
    });
    expect((await resolveAuth(basic)).auth).toEqual({ mode: "basic", user: "u", password: "password123" });
    const none = parseConfig({ BRAVIA_TV: "http://tv", BRAVIA_AUTH_MODE: "none" });
    expect((await resolveAuth(none)).auth).toEqual({ mode: "none" });
  });
});
