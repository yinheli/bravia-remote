import { describe, expect, test } from "bun:test";
import { ConfigError, parseConfig } from "./config";

describe("parseConfig", () => {
  test("requires BRAVIA_TV", () => {
    expect(() => parseConfig({})).toThrow(ConfigError);
    expect(() => parseConfig({ BRAVIA_TV: "   " })).toThrow(/BRAVIA_TV is required/);
  });

  test("rejects invalid URLs and protocols", () => {
    expect(() => parseConfig({ BRAVIA_TV: "not a url" })).toThrow(ConfigError);
    expect(() => parseConfig({ BRAVIA_TV: "ftp://tv" })).toThrow(/http\(s\)/);
  });

  test("defaults", () => {
    const c = parseConfig({ BRAVIA_TV: "http://192.0.2.10" });
    expect(c.tvUrl).toBe("http://192.0.2.10");
    expect(c.host).toBe("127.0.0.1");
    expect(c.port).toBe(8765);
    expect(c.adbPath).toBe("adb");
    expect(c.timeoutMs).toBe(4000);
    expect(c.clientId).toBe("bravia-remote");
    expect(c.clientIdFromEnv).toBe(false);
    expect(c.psk).toBeNull();
    expect(c.customApps).toEqual([]);
    expect(c.authFile.endsWith(".config/bravia-remote/auth.json")).toBe(true);
    expect(c.authMode).toBe("token");
    expect(c.token).toBeNull();
    expect(c.tokenFile.endsWith(".config/bravia-remote/.bravia_token")).toBe(true);
    expect(c.basicUser).toBe("admin");
    expect(c.basicPassword).toBeNull();
  });

  test("parses auth modes and rejects invalid auth config", () => {
    const token = parseConfig({ BRAVIA_TV: "http://tv", BRAVIA_TOKEN: "0123456789abcdef" });
    expect(token.authMode).toBe("token");
    expect(token.token).toBe("0123456789abcdef");
    const basic = parseConfig({
      BRAVIA_TV: "http://tv",
      BRAVIA_AUTH_MODE: "basic",
      BRAVIA_BASIC_USER: "u",
      BRAVIA_BASIC_PASSWORD: "password123",
      BRAVIA_TOKEN_FILE: "/tmp/token",
    });
    expect(basic.authMode).toBe("basic");
    expect(basic.basicUser).toBe("u");
    expect(basic.basicPassword).toBe("password123");
    expect(basic.tokenFile).toBe("/tmp/token");
    expect(() => parseConfig({ BRAVIA_TV: "http://tv", BRAVIA_AUTH_MODE: "off" })).toThrow(/token, basic, or none/);
    expect(parseConfig({ BRAVIA_TV: "http://tv", BRAVIA_TOKEN: "abcd" }).token).toBe("abcd");
    expect(() => parseConfig({ BRAVIA_TV: "http://tv", BRAVIA_TOKEN: "abc" })).toThrow(/at least 4/);
    expect(() => parseConfig({ BRAVIA_TV: "http://tv", BRAVIA_AUTH_MODE: "basic" })).toThrow(/BRAVIA_BASIC_PASSWORD/);
    expect(() =>
      parseConfig({ BRAVIA_TV: "http://tv", BRAVIA_AUTH_MODE: "basic", BRAVIA_BASIC_PASSWORD: "short" }),
    ).toThrow(/at least 8/);
  });

  test("strips trailing slash from the TV URL", () => {
    expect(parseConfig({ BRAVIA_TV: "http://tv.local/" }).tvUrl).toBe("http://tv.local");
  });

  test("honors overrides", () => {
    const c = parseConfig({
      BRAVIA_TV: "https://tv.local",
      HOST: "0.0.0.0",
      PORT: "9000",
      BRAVIA_AUTH_FILE: "/tmp/auth.json",
      BRAVIA_ADB: "/opt/adb",
      BRAVIA_TIMEOUT_MS: "2500",
      BRAVIA_CLIENT_ID: "my-remote",
      BRAVIA_PUBLIC_ORIGIN: "https://remote.example.com/",
      BRAVIA_PSK: "s3cret",
      XDG_CONFIG_HOME: "/custom/config",
    });
    expect(c.host).toBe("0.0.0.0");
    expect(c.port).toBe(9000);
    expect(c.authFile).toBe("/tmp/auth.json");
    expect(c.adbPath).toBe("/opt/adb");
    expect(c.timeoutMs).toBe(2500);
    expect(c.clientId).toBe("my-remote");
    expect(c.clientIdFromEnv).toBe(true);
    expect(c.publicOrigin).toBe("https://remote.example.com");
    expect(c.psk).toBe("s3cret");
  });

  test("rejects public origins with paths or credentials", () => {
    expect(() => parseConfig({ BRAVIA_TV: "http://t", BRAVIA_PUBLIC_ORIGIN: "https://remote.example.com/ui" })).toThrow(
      /must be an origin/,
    );
    expect(() =>
      parseConfig({ BRAVIA_TV: "http://t", BRAVIA_PUBLIC_ORIGIN: "https://user@remote.example.com" }),
    ).toThrow(/must be an origin/);
    expect(() => parseConfig({ BRAVIA_TV: "http://t", BRAVIA_PUBLIC_ORIGIN: "not a url" })).toThrow(
      /not a valid origin/,
    );
  });

  test("rejects ports above 65535", () => {
    expect(() => parseConfig({ BRAVIA_TV: "http://tv", PORT: "65536" })).toThrow(/PORT must be <= 65535/);
  });

  test("rejects timer values beyond the platform limit", () => {
    expect(() => parseConfig({ BRAVIA_TV: "http://tv", BRAVIA_TIMEOUT_MS: "2147483648" })).toThrow(/BRAVIA_TIMEOUT_MS/);
    expect(() => parseConfig({ BRAVIA_TV: "http://tv", BRAVIA_SCREEN_TIMEOUT_MS: "2147483648" })).toThrow(
      /BRAVIA_SCREEN_TIMEOUT_MS/,
    );
  });

  test("rejects non-positive or non-integer numeric values", () => {
    expect(() => parseConfig({ BRAVIA_TV: "http://t", PORT: "0" })).toThrow(ConfigError);
    expect(() => parseConfig({ BRAVIA_TV: "http://t", BRAVIA_TIMEOUT_MS: "abc" })).toThrow(ConfigError);
    expect(() => parseConfig({ BRAVIA_TV: "http://t", BRAVIA_TIMEOUT_MS: "-5" })).toThrow(ConfigError);
  });

  test("parses BRAVIA_APPS name=uri pairs", () => {
    const c = parseConfig({
      BRAVIA_TV: "http://t",
      BRAVIA_APPS: "Bilibili=com.sony.dtv.bili, Netflix=com.sony.dtv.netflix",
    });
    expect(c.customApps).toEqual([
      { name: "Bilibili", uri: "com.sony.dtv.bili" },
      { name: "Netflix", uri: "com.sony.dtv.netflix" },
    ]);
  });

  test("rejects malformed BRAVIA_APPS entries", () => {
    expect(() => parseConfig({ BRAVIA_TV: "http://t", BRAVIA_APPS: "no-uri-here" })).toThrow(ConfigError);
    expect(() => parseConfig({ BRAVIA_TV: "http://t", BRAVIA_APPS: "=some.uri" })).toThrow(ConfigError);
    expect(() => parseConfig({ BRAVIA_TV: "http://t", BRAVIA_APPS: "N=bad uri with spaces" })).toThrow(ConfigError);
  });

  test("derives auth file from XDG_CONFIG_HOME", () => {
    const c = parseConfig({ BRAVIA_TV: "http://t", XDG_CONFIG_HOME: "/x" });
    expect(c.authFile).toBe("/x/bravia-remote/auth.json");
  });
});
