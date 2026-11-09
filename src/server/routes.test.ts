/**
 * Integration tests: drive the real route handler against a mock Bravia TV
 * (a local Bun server speaking the Simple IP Control shapes). No real TV is
 * involved anywhere.
 */

import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanupTempDirs, tempDir } from "../test-support/temp";
import { type AppContext, createApp } from "./app";
import { BraviaClient } from "./client";
import { parseConfig } from "./config";
import { CredentialStore } from "./credentials";
import { AppHistory } from "./history";

type TvRequest = { path: string; method: string; body: Record<string, unknown>; psk?: string; authorization?: string };

const tvRequests: TvRequest[] = [];

const mockTv = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const { pathname } = new URL(req.url);
    const raw = await req.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const psk = req.headers.get("x-auth-psk") ?? undefined;
    const authorization = req.headers.get("authorization") ?? undefined;
    const method = typeof body.method === "string" ? body.method : "";
    tvRequests.push({ path: pathname, method, body, psk, authorization });

    if (pathname === "/sony/IRCC") {
      if (raw.includes("REJECT")) return new Response("<s:Fault/>", { status: 500 });
      return new Response("", { status: 200 });
    }
    if (pathname === "/sony/accessControl") {
      const params = Array.isArray(body.params) ? (body.params[0] as Record<string, unknown>) : {};
      if (params.nickname === "ERR500") return Response.json({ error: [500, "busy"] });
      if (authorization === `Basic ${Buffer.from(":1234").toString("base64")}` || authorization === "Basic issued")
        return new Response(JSON.stringify({ result: [""] }), {
          headers: { "content-type": "application/json", authorization: "Basic issued", "set-cookie": "ck=1" },
        });
      // A PSK-configured TV accepts the registration silently; otherwise it
      // asks the client to display the registration key.
      if (!authorization && psk) return Response.json({ result: [""] });
      // No auth yet → show the registration key; wrong key → reject.
      return Response.json({ error: [authorization ? 401 : 40003, "auth"] }, { status: 401 });
    }

    if (method === "getPowerStatus") return Response.json({ result: [{ status: "standby" }] });
    if (method === "getRemoteControllerInfo")
      return Response.json({
        result: [["AES"], [{ name: "Up", value: "AAAUp==" }, { name: "Home", value: "AAAHome==" }, { junk: true }]],
      });
    if (method === "getInterfaceInformation") return Response.json({ result: [{ modelName: "XR-55A80K" }] });
    if (method === "getCurrentExternalInputsStatus")
      return Response.json({ result: [[{ uri: "hdmi1", title: "PS5", connection: true }]] });
    if (method === "getVolumeInformation")
      return Response.json({ result: [[{ target: "speaker", volume: 22, mute: false }]] });
    if (method === "getPlayingContentInfo") return Response.json({ result: [{ title: "Movie", source: "hdmi:1" }] });
    if (method === "getCurrentTime") return Response.json({ result: ["2026-01-01 12:00:00"] });
    if (method === "getPowerSavingMode") return Response.json({ result: [{ mode: "off" }] });
    if (method === "setActiveApp") return Response.json({ result: [0] });
    if (method === "getSystemInformation")
      return psk === "good-psk"
        ? Response.json({ result: [{ model: "XR-55" }] })
        : psk === "boom"
          ? Response.json({ error: [500, "boom"] })
          : Response.json({ error: [403, "psk mismatch"] }, { status: 403 });
    return Response.json({ error: [1, "unknown method"] });
  },
});

const TV_URL = `http://127.0.0.1:${mockTv.port}`;

type AppHandler = (req: Request) => Response | Promise<Response>;

type Harness = {
  dataDir: string;
  credentials: CredentialStore;
  ctx: AppContext;
  handle: AppHandler;
  call: (path: string, init?: RequestInit) => Promise<Response>;
  post: (path: string, body: unknown) => Promise<Response>;
};

/**
 * Fresh credentials, history, and app per test. Only the mock TV is shared;
 * every test arranges the state it depends on, so declaration order and
 * randomization cannot leak state between tests.
 */
const makeHarness = async (options: { adbPath?: string } = {}): Promise<Harness> => {
  const dataDir = await tempDir("bravia-routes-");
  const credentials = await CredentialStore.open(join(dataDir, "auth.json"), {
    clientId: "cid",
    nickname: "host",
    psk: null,
  });
  const config = parseConfig({
    BRAVIA_TV: TV_URL,
    BRAVIA_AUTH_FILE: join(dataDir, "auth.json"),
    BRAVIA_APPS: "TestApp=com.sony.dtv.test",
    BRAVIA_ADB: options.adbPath,
  });
  const ctx: AppContext = {
    config,
    credentials,
    tv: new BraviaClient({ baseUrl: config.tvUrl, credentials }),
    history: new AppHistory(),
  };
  const handle = createApp(ctx, { mode: "none" });
  const call = (path: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(handle(new Request(`http://127.0.0.1:8765${path}`, init)));
  const post = (path: string, body: unknown): Promise<Response> =>
    call(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { dataDir, credentials, ctx, handle, call, post };
};

let h: Harness;

beforeEach(async () => {
  tvRequests.length = 0;
  h = await makeHarness();
});

afterAll(async () => {
  await mockTv.stop(true);
  await cleanupTempDirs();
});

describe("static assets", () => {
  test("serves the embedded html, css, and js with no-store", async () => {
    const html = await h.call("/");
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(html.headers.get("cache-control")).toBe("no-store");
    expect(html.headers.get("x-frame-options")).toBe("DENY");
    expect(html.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    const htmlText = await html.text();
    expect(htmlText).toContain("<!doctype html>");
    expect(htmlText).toContain('href="./app.css"');
    expect(htmlText).toContain('href="./favicon.svg"');
    expect((await h.call("/index.html")).status).toBe(200);
    const icon = await h.call("/favicon.svg");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toContain("image/svg+xml");
    expect(await icon.text()).toContain("<svg");
    const css = await h.call("/app.css");
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).not.toBe("");
    const js = await h.call("/app.js");
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(await js.text()).not.toBe("");
  });

  test("404s unknown paths, including Object.prototype names", async () => {
    expect((await h.call("/nope")).status).toBe(404);
    expect((await h.call("/api/nope")).status).toBe(404);
    expect((await h.call("/__proto__")).status).toBe(404);
    expect((await h.call("/constructor")).status).toBe(404);
  });
});

describe("route methods", () => {
  test("HEAD and OPTIONS do not reach GET handlers", async () => {
    expect((await h.call("/api/screen", { method: "HEAD" })).status).toBe(404);
    expect((await h.call("/api/screen", { method: "OPTIONS" })).status).toBe(404);
    expect((await h.call("/api/pair", { method: "OPTIONS" })).status).toBe(404);
  });
});

describe("authentication", () => {
  const token = "0123456789abcdef0123456789abcdef";
  const basicHeader = `Basic ${Buffer.from("admin:s3cret123").toString("base64")}`;

  test("token mode serves the UI but protects the API", async () => {
    const tokenApp = createApp(h.ctx, { mode: "token", token });
    expect((await Promise.resolve(tokenApp(new Request("http://127.0.0.1:8765/")))).status).toBe(200);
    const denied = await Promise.resolve(tokenApp(new Request("http://127.0.0.1:8765/api/auth")));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toBeNull();
    const ok = await Promise.resolve(
      tokenApp(new Request("http://127.0.0.1:8765/api/auth", { headers: { authorization: `Bearer ${token}` } })),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, mode: "token" });
    const bad = await Promise.resolve(
      tokenApp(new Request("http://127.0.0.1:8765/api/status", { headers: { authorization: "Bearer wrong-token" } })),
    );
    expect(bad.status).toBe(401);
  });

  test("token login sets an HttpOnly session cookie and logout clears it", async () => {
    const tokenApp = createApp(h.ctx, { mode: "token", token });
    const login = await Promise.resolve(
      tokenApp(
        new Request("http://127.0.0.1:8765/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        }),
      ),
    );
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Max-Age=");
    const cookie = setCookie.split(";")[0] ?? "";
    expect(cookie).toContain("bravia_session=");

    const status = await Promise.resolve(
      tokenApp(new Request("http://127.0.0.1:8765/api/auth", { headers: { cookie } })),
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ ok: true, mode: "token" });

    const wrong = await Promise.resolve(
      tokenApp(
        new Request("http://127.0.0.1:8765/api/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "wrong-token-value" }),
        }),
      ),
    );
    expect(wrong.status).toBe(401);

    const logout = await Promise.resolve(
      tokenApp(new Request("http://127.0.0.1:8765/api/auth", { method: "DELETE", headers: { cookie } })),
    );
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("basic mode protects the document and challenges the browser", async () => {
    const basicApp = createApp(h.ctx, { mode: "basic", user: "admin", password: "s3cret123" });
    const denied = await Promise.resolve(basicApp(new Request("http://127.0.0.1:8765/")));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain("Basic");
    const ok = await Promise.resolve(
      basicApp(new Request("http://127.0.0.1:8765/", { headers: { authorization: basicHeader } })),
    );
    expect(ok.status).toBe(200);
    const status = await Promise.resolve(
      basicApp(new Request("http://127.0.0.1:8765/api/auth", { headers: { authorization: basicHeader } })),
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ ok: true, mode: "basic" });
  });

  test("none mode reports its mode without a credential", async () => {
    const r = await h.call("/api/auth");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, mode: "none" });
  });
});

describe("route policy", () => {
  const token = "0123456789abcdef0123456789abcdef";
  const tokened = (path: string, init?: RequestInit): Promise<Response> =>
    Promise.resolve(createApp(h.ctx, { mode: "token", token })(new Request(`http://127.0.0.1:8765${path}`, init)));

  test("POST /api/auth is public for token login", async () => {
    const r = await tokened("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, mode: "token" });
  });

  test("an unauthenticated API write returns 401", async () => {
    const r = await tokened("/api/key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "AAAAAA==" }),
    });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ ok: false, error: ["unauthorized"] });
  });

  test("a cross-site screenshot read is blocked", async () => {
    const r = await tokened("/api/screen", {
      headers: { authorization: `Bearer ${token}`, "sec-fetch-site": "cross-site" },
    });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ ok: false, error: ["forbidden"] });
  });

  test("a same-origin authenticated write passes policy", async () => {
    const r = await tokened("/api/key", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        origin: "http://127.0.0.1:8765",
      },
      body: JSON.stringify({ code: "AAAAAA==" }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  test("unknown API paths still get auth and Origin checks before the 404", async () => {
    expect((await tokened("/api/nope")).status).toBe(401);
    expect((await tokened("/api/nope", { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    const crossOrigin = await tokened("/api/nope", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, origin: "https://evil.example" },
    });
    expect(crossOrigin.status).toBe(403);
  });
});

/**
 * The documented guard order is Host -> credential -> cross-site screenshot ->
 * Origin. Each case pairs a rejected request with a real credential so the
 * 401-vs-403 status pins which guard fired.
 */
describe("auth and guard ordering", () => {
  const token = "0123456789abcdef0123456789abcdef";
  const basicHeader = `Basic ${Buffer.from("admin:s3cret123").toString("base64")}`;
  const missingAdb = "/nonexistent/bravia-routes-adb";
  const tokenApp = (): AppHandler => createApp(h.ctx, { mode: "token", token });
  const basicApp = (): AppHandler => createApp(h.ctx, { mode: "basic", user: "admin", password: "s3cret123" });
  const keyRequest = (headers: Record<string, string>): Request =>
    new Request("http://127.0.0.1:8765/api/key", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ code: "AAAAAA==" }),
    });
  const screenRequest = (headers: Record<string, string> = {}): Request =>
    new Request("http://127.0.0.1:8765/api/screen", { headers });

  test("token mode: a missing credential answers 401 before the Origin guard", async () => {
    const app = tokenApp();
    const anonymous = await app(keyRequest({ origin: "https://evil.example" }));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ ok: false, error: ["unauthorized"] });

    const authenticated = await app(keyRequest({ authorization: `Bearer ${token}`, origin: "https://evil.example" }));
    expect(authenticated.status).toBe(403);
    expect(await authenticated.json()).toEqual({ ok: false, error: ["forbidden"] });
  });

  test("token mode: a missing credential answers 401 before the cross-site screenshot guard", async () => {
    const app = tokenApp();
    const anonymous = await app(screenRequest({ "sec-fetch-site": "cross-site" }));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ ok: false, error: ["unauthorized"] });

    const authenticated = await app(
      screenRequest({ authorization: `Bearer ${token}`, "sec-fetch-site": "cross-site" }),
    );
    expect(authenticated.status).toBe(403);
  });

  test("token mode: Bearer and session-cookie credentials reach the key and screen handlers", async () => {
    // A nonexistent adb path makes the screen handler answer 502 only after auth passed.
    const probe = await makeHarness({ adbPath: missingAdb });
    const app = createApp(probe.ctx, { mode: "token", token });

    const key = await app(keyRequest({ authorization: `Bearer ${token}` }));
    expect(key.status).toBe(200);
    expect(await key.json()).toEqual({ ok: true });

    const login = await app(
      new Request("http://127.0.0.1:8765/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );
    expect(login.status).toBe(200);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    expect(cookie).toContain("bravia_session=");

    const screen = await app(screenRequest({ cookie }));
    expect(screen.status).toBe(502);
    expect(await screen.json()).toEqual({ ok: false, error: "adb-missing", bytes: null });
  });

  test("basic mode: missing credentials get the challenge before Origin and screenshot guards", async () => {
    const app = basicApp();
    const key = await app(keyRequest({ origin: "https://evil.example" }));
    expect(key.status).toBe(401);
    expect(key.headers.get("www-authenticate")).toContain("Basic");
    expect(await key.json()).toEqual({ ok: false, error: ["unauthorized"] });

    const screen = await app(screenRequest({ "sec-fetch-site": "cross-site" }));
    expect(screen.status).toBe(401);
    expect(screen.headers.get("www-authenticate")).toContain("Basic");
  });

  test("basic mode: valid Basic reaches the key and screen handlers", async () => {
    const probe = await makeHarness({ adbPath: missingAdb });
    const app = createApp(probe.ctx, { mode: "basic", user: "admin", password: "s3cret123" });

    const key = await app(keyRequest({ authorization: basicHeader }));
    expect(key.status).toBe(200);
    expect(await key.json()).toEqual({ ok: true });

    const screen = await app(screenRequest({ authorization: basicHeader }));
    expect(screen.status).toBe(502);
    expect(await screen.json()).toEqual({ ok: false, error: "adb-missing", bytes: null });
  });

  test("basic mode: an authenticated write is still subject to Origin and screenshot guards", async () => {
    const app = basicApp();
    const crossOrigin = await app(keyRequest({ authorization: basicHeader, origin: "https://evil.example" }));
    expect(crossOrigin.status).toBe(403);
    expect(await crossOrigin.json()).toEqual({ ok: false, error: ["forbidden"] });

    const crossSite = await app(screenRequest({ authorization: basicHeader, "sec-fetch-site": "cross-site" }));
    expect(crossSite.status).toBe(403);
  });

  test("a foreign Host is rejected before authentication", async () => {
    const app = tokenApp();
    const foreign = (headers: Record<string, string>): Request =>
      new Request("http://evil.example:8765/api/key", {
        method: "POST",
        // Origin matches the URL so the Host guard is the only rejecter.
        headers: {
          host: "evil.example:8765",
          origin: "http://evil.example:8765",
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ code: "AAAAAA==" }),
      });

    const anonymous = await app(foreign({}));
    expect(anonymous.status).toBe(403);
    expect(await anonymous.json()).toEqual({ ok: false, error: ["forbidden"] });

    const authenticated = await app(foreign({ authorization: `Bearer ${token}` }));
    expect(authenticated.status).toBe(403);
  });
});

describe("status/codes/info", () => {
  test("passthrough power status", async () => {
    const j = (await (await h.call("/api/status")).json()) as { result?: { status: string }[] };
    expect(j.result?.[0]?.status).toBe("standby");
  });

  test("maps remote controller codes", async () => {
    const j = (await (await h.call("/api/codes")).json()) as { name: string; code: string }[];
    expect(j).toEqual([
      { name: "Up", code: "AAAUp==" },
      { name: "Home", code: "AAAHome==" },
    ]);
  });

  test("codes failures are distinguishable from an empty success", async () => {
    const codesBody = async (rpc: () => Promise<unknown>): Promise<unknown> => {
      const app = createApp({ ...h.ctx, tv: { rpc } as unknown as BraviaClient }, { mode: "none" });
      return (await Promise.resolve(app(new Request("http://127.0.0.1:8765/api/codes")))).json();
    };

    // A TV rejection (standby, transport, or protocol error) keeps its envelope.
    expect(await codesBody(() => Promise.resolve({ error: [40005, "standby"] }))).toEqual({
      error: [40005, "standby"],
    });
    // A body without the expected result shape is a failure, not an empty list.
    expect(await codesBody(() => Promise.resolve({}))).toEqual({
      error: ["unknown", "unexpected getRemoteControllerInfo response"],
    });
    // A real empty list stays an empty array so the web can latch it if needed.
    expect(await codesBody(() => Promise.resolve({ result: [["AES"], []] }))).toEqual([]);
  });

  test("aggregates info from parallel calls", async () => {
    const j = (await (await h.call("/api/info")).json()) as Record<string, unknown>;
    expect(Object.keys(j).sort()).toEqual(["iface", "inputs", "playing", "power", "powerSaving", "time", "volume"]);
  });
});

describe("key + app control", () => {
  test("POST /api/key sends IRCC and validates the body", async () => {
    const ok = await h.post("/api/key", { code: "AAAAUp==" });
    expect(await ok.json()).toEqual({ ok: true });
    expect(tvRequests.at(-1)).toMatchObject({ path: "/sony/IRCC" });

    const bad = await h.post("/api/key", {});
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: ["bad"] });
  });

  test("POST /api/key surfaces TV SOAP faults with their status", async () => {
    const fault = await h.post("/api/key", { code: "REJECTme==" });
    expect(fault.status).toBe(500);
    expect(await fault.json()).toEqual({ ok: false, error: "unsupported" });
  });

  test("GET /api/key is not routed", async () => {
    expect((await h.call("/api/key")).status).toBe(404);
  });

  test("POST /api/app validates the uri", async () => {
    const bad = await h.post("/api/app", { uri: "bad uri with spaces" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: ["bad"] });
    // Missing uri takes the same 400 path.
    const missing = await h.post("/api/app", {});
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ ok: false, error: ["bad"] });
  });

  test("back:true takes precedence over an invalid uri", async () => {
    const fresh = createApp({ ...h.ctx, history: new AppHistory() }, { mode: "none" });
    const r = await Promise.resolve(
      fresh(
        new Request("http://127.0.0.1:8765/api/app", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ back: true, uri: "not a valid uri" }),
        }),
      ),
    );
    expect(await r.json()).toEqual({ ok: false, error: ["none"] });
  });

  test("back with empty history answers the none machine code", async () => {
    const fresh = createApp({ ...h.ctx, history: new AppHistory() }, { mode: "none" });
    const r = await Promise.resolve(
      fresh(
        new Request("http://127.0.0.1:8765/api/app", {
          method: "POST",
          body: JSON.stringify({ back: true }),
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    expect(await r.json()).toEqual({ ok: false, error: ["none"] });
  });

  test("launch then back walks the MRU history", async () => {
    await h.post("/api/app", { uri: "app.a" });
    await h.post("/api/app", { uri: "app.b" });
    expect(await (await h.post("/api/app", { back: true })).json()).toEqual({ ok: true, app: "app.a" });

    // Launching a new app makes the previous newest ("app.a") the back target.
    await h.post("/api/app", { uri: "app.c" });
    expect(await (await h.post("/api/app", { back: true })).json()).toEqual({ ok: true, app: "app.a" });
  });

  test("GET /api/config returns the configured apps", async () => {
    expect(await (await h.call("/api/config")).json()).toEqual({
      apps: [{ name: "TestApp", uri: "com.sony.dtv.test" }],
    });
  });
});

describe("request hardening", () => {
  test("cross-origin POST is rejected (CSRF guard)", async () => {
    const r = await h.call("/api/key", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ code: "AAAAAA==" }),
    });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ ok: false, error: ["forbidden"] });
  });

  test("config-allowed origin passes", async () => {
    const r = await h.call("/api/key", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:8765" },
      body: JSON.stringify({ code: "AAAAAA==" }),
    });
    expect(r.status).toBe(200);
  });

  test("configured public origin works behind a TLS proxy", async () => {
    const publicConfig = parseConfig({
      BRAVIA_TV: TV_URL,
      BRAVIA_AUTH_FILE: join(h.dataDir, "public-auth.json"),
      BRAVIA_PUBLIC_ORIGIN: "https://remote.example.com",
    });
    const publicApp = createApp({ ...h.ctx, config: publicConfig }, { mode: "none" });
    const r = await Promise.resolve(
      publicApp(
        new Request("http://remote.example.com:8765/api/key", {
          method: "POST",
          headers: {
            host: "remote.example.com:8765",
            origin: "https://remote.example.com",
            "content-type": "application/json",
          },
          body: JSON.stringify({ code: "AAAAAA==" }),
        }),
      ),
    );
    expect(r.status).toBe(200);
  });

  test("oversized JSON body is rejected before parsing", async () => {
    const r = await h.call("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nickname: "x".repeat(70 * 1024) }),
    });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, error: ["bad"] });
  });

  test("foreign Host header is rejected (DNS rebinding guard)", async () => {
    const r = await h.handle(
      new Request("http://evil.example:8765/api/status", {
        headers: { host: "evil.example:8765" },
      }),
    );
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ ok: false, error: ["forbidden"] });
    // Loopback access keeps working.
    const ok = await h.call("/api/status");
    expect(ok.status).toBe(200);
  });

  test("bracketed IPv6 Host headers match the bare literal allowlist", async () => {
    const r = await h.handle(
      new Request("http://[::1]:8765/api/status", {
        headers: { host: "[::1]:8765" },
      }),
    );
    expect(r.status).toBe(200);
  });

  test("wildcard binds skip the Host guard but keep the Origin guard", async () => {
    const wildcardCredentials = await CredentialStore.open(join(h.dataDir, "wild-auth.json"), {
      clientId: "cid",
      nickname: "host",
      psk: null,
    });
    const wildcardConfig = parseConfig({
      BRAVIA_TV: TV_URL,
      BRAVIA_AUTH_FILE: join(h.dataDir, "wild-auth.json"),
      HOST: "0.0.0.0",
    });
    const wildcard = createApp(
      {
        config: wildcardConfig,
        credentials: wildcardCredentials,
        tv: h.ctx.tv,
        history: new AppHistory(),
      },
      { mode: "none" },
    );
    // Arbitrary LAN hostname passes the (skipped) Host guard.
    const lan = await Promise.resolve(wildcard(new Request(`http://192.0.2.5:${wildcardConfig.port}/api/status`)));
    expect(lan.status).toBe(200);
    // Cross-origin writes are still rejected.
    const csrf = await Promise.resolve(
      wildcard(
        new Request("http://192.0.2.5:8765/api/key", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "https://evil.example" },
          body: JSON.stringify({ code: "AAAAAA==" }),
        }),
      ),
    );
    expect(csrf.status).toBe(403);
    // Same-origin writes (browser at the LAN address) keep working.
    const sameOrigin = await Promise.resolve(
      wildcard(
        new Request("http://192.0.2.5:8765/api/key", {
          method: "POST",
          headers: { "content-type": "application/json", origin: `http://192.0.2.5:${wildcardConfig.port}` },
          body: JSON.stringify({ code: "AAAAAA==" }),
        }),
      ),
    );
    expect(sameOrigin.status).toBe(200);
    // Documented trade-off: under HOST=0.0.0.0 a DNS-rebinding POST whose
    // Origin echoes the (attacker-controlled) Host also passes — the wildcard
    // bind cannot distinguish it from a LAN user. Prefer HOST=<LAN IP>.
    const rebound = await Promise.resolve(
      wildcard(
        new Request("http://evil.example:8765/api/key", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "evil.example:8765",
            origin: "http://evil.example:8765",
          },
          body: JSON.stringify({ code: "AAAAAA==" }),
        }),
      ),
    );
    expect(rebound.status).toBe(200);
  });

  test("cross-site screenshot fetch (img/iframe) is rejected", async () => {
    const r = await h.handle(
      new Request("http://127.0.0.1:8765/api/screen", {
        headers: { host: "127.0.0.1:8765", "sec-fetch-site": "cross-site" },
      }),
    );
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ ok: false, error: ["forbidden"] });
    // Same-site loads keep working (no sec-fetch-site from curl/scripts);
    // without a real adb the pipeline answers its machine code.
    const ok = await h.handle(
      new Request("http://127.0.0.1:8765/api/screen", {
        headers: { host: "127.0.0.1:8765" },
      }),
    );
    expect(ok.status).toBe(502);
    expect(await ok.json()).toEqual({ ok: false, error: "adb-missing", bytes: null });
  });

  test("non-JSON content-type is rejected (CSRF simplified request)", async () => {
    const r = await h.call("/api/key", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ code: "AAAAAA==" }),
    });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, error: ["bad"] });
  });

  test("malformed JSON body yields machine-readable 400, not a 500", async () => {
    const r = await h.call("/api/key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ ok: false, error: ["bad"] });
  });

  test("unexpected handler failure returns JSON 500, not an HTML error page", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const failing = createApp(
        {
          ...h.ctx,
          tv: { rpc: () => Promise.reject(new Error("rpc exploded")) } as unknown as BraviaClient,
        },
        { mode: "none" },
      );
      const r = await Promise.resolve(failing(new Request("http://127.0.0.1:8765/api/info")));
      expect(r.status).toBe(500);
      expect(r.headers.get("content-type")).toContain("application/json");
      expect(await r.json()).toEqual({ ok: false, error: ["unknown"] });
    } finally {
      logged.mockRestore();
    }
  });

  test("IRCC codes must look like base64", async () => {
    const bad = await h.post("/api/key", { code: "<script>alert(1)</script>" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: ["bad"] });
    const ok = await h.post("/api/key", { code: "AAAAAQAAAAEAAAAUAw==" });
    expect(await ok.json()).toEqual({ ok: true });
  });
});

describe("pairing", () => {
  // The normal-mode flow is inherently sequential: bootstrap asks the TV to
  // show a key, then the confirmation persists the credentials. Keep the
  // transition in one test; every other test starts from a fresh store.
  test("normal-mode lifecycle: bootstrap -> PIN confirmation -> paired", async () => {
    expect(await (await h.call("/api/pair")).json()).toMatchObject({ paired: false });
    expect(await (await h.post("/api/pair", {})).json()).toEqual({ ok: false, needKey: true, code: 40003 });
    expect(await (await h.post("/api/pair", { key: "1234" })).json()).toEqual({ ok: true, paired: true });
    expect(await (await h.call("/api/pair")).json()).toMatchObject({ paired: true });
  });

  test("GET /api/pair reports initial status", async () => {
    expect(await (await h.call("/api/pair")).json()).toEqual({ nickname: "host", clientid: "cid", paired: false });
  });

  test("bootstrap request answers needKey", async () => {
    expect(await (await h.post("/api/pair", {})).json()).toEqual({ ok: false, needKey: true, code: 40003 });
    expect(tvRequests.at(-1)).toMatchObject({ path: "/sony/accessControl", method: "actRegister" });
  });

  test("PIN confirmation persists credentials", async () => {
    expect(await (await h.post("/api/pair", { key: "1234" })).json()).toEqual({ ok: true, paired: true });
    expect(h.credentials.paired).toBe(true);
    expect(h.credentials.snapshot.credential).toBe("Basic issued");

    const saved = JSON.parse(await readFile(join(h.dataDir, "auth.json"), "utf8")) as Record<string, unknown>;
    expect(saved.credential).toBe("Basic issued");
    expect(saved.cookie).toBe("ck=1");
  });

  test("wrong PIN answers needKey with the TV code", async () => {
    expect(await (await h.post("/api/pair", { key: "9999" })).json()).toEqual({
      ok: false,
      needKey: true,
      code: 401,
    });
  });

  test("PIN confirmation transport failure is an error, not a key challenge", async () => {
    const offline = new BraviaClient({
      baseUrl: TV_URL,
      credentials: h.credentials,
      fetch: () => Promise.reject(new Error("offline")),
    });
    const r = await Promise.resolve(
      createApp(
        { ...h.ctx, tv: offline },
        { mode: "none" },
      )(
        new Request("http://127.0.0.1:8765/api/pair", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: "1234" }),
        }),
      ),
    );
    expect(await r.json()).toEqual({ ok: false, error: [504, "TV unreachable"] });
  });

  test("PIN confirmation TV server failure is an error, not a key challenge", async () => {
    const busy = new BraviaClient({
      baseUrl: TV_URL,
      credentials: h.credentials,
      fetch: () => Promise.resolve(Response.json({ error: [500, "busy"] })),
    });
    const r = await Promise.resolve(
      createApp(
        { ...h.ctx, tv: busy },
        { mode: "none" },
      )(
        new Request("http://127.0.0.1:8765/api/pair", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: "1234" }),
        }),
      ),
    );
    expect(await r.json()).toEqual({ ok: false, error: [500, "pairing failed"] });
  });

  test("valid PSK is persisted and reports psk mode", async () => {
    expect(await (await h.post("/api/pair", { psk: "good-psk" })).json()).toEqual({
      ok: true,
      paired: true,
      mode: "psk",
    });
    expect(h.credentials.psk).toBe("good-psk");
    expect(tvRequests.at(-1)).toMatchObject({ psk: "good-psk" });
  });

  test("bootstrap succeeds silently when the TV has PSK auth", async () => {
    // Arrange a paired store; the mock TV accepts the registration silently.
    await h.credentials.setPsk("good-psk");
    expect(await (await h.post("/api/pair", {})).json()).toEqual({ ok: true, paired: true });
  });

  test("PSK probe errors other than 401/403 pass through verbatim", async () => {
    expect(await (await h.post("/api/pair", { psk: "boom" })).json()).toEqual({ ok: false, error: [500, "boom"] });
    expect(h.credentials.psk).not.toBe("boom");
  });

  test("bootstrap unexpected TV errors pass through verbatim", async () => {
    const saved = h.credentials.nickname;
    await h.credentials.setNickname("ERR500");
    expect(await (await h.post("/api/pair", {})).json()).toEqual({ ok: false, error: [500, "busy"] });
    await h.credentials.setNickname(saved);
  });

  test("invalid PSK answers the auth code without persisting", async () => {
    await h.credentials.setPsk("good-psk");
    expect(await (await h.post("/api/pair", { psk: "wrong" })).json()).toEqual({ ok: false, error: ["auth"] });
    expect(h.credentials.psk).toBe("good-psk");
  });

  test("nickname updates are persisted", async () => {
    // Pair first so the status assertion below is about the nickname, not pairing.
    await h.credentials.setPsk("good-psk");
    await h.post("/api/pair", { nickname: "living-room" });
    expect(h.credentials.nickname).toBe("living-room");
    expect(await (await h.call("/api/pair")).json()).toMatchObject({ nickname: "living-room", paired: true });
  });
});
