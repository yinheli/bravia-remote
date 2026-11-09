import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cleanupTempDirs, tempFile } from "../test-support/temp";
import { BraviaClient, type FetchLike } from "./client";
import { CredentialStore } from "./credentials";

type Call = { url: string; init?: RequestInit };

/** Records every call and answers from a canned handler. */
const mockFetch = (handler: (url: string, init?: RequestInit) => Response) => {
  const calls: Call[] = [];
  const fetchLike: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { calls, fetchLike };
};

const store = (psk: string | null = null) =>
  CredentialStore.open("/nonexistent/auth.json", { clientId: "test-client", nickname: "tester", psk });

/** First recorded call; throws so a missing call fails loudly in assertions. */
const firstCall = (calls: Call[]): Call => {
  const call = calls[0];
  if (!call) throw new Error("expected at least one fetch call");
  return call;
};

/** Request bodies are always strings in this client; narrow for assertions. */
const bodyOf = (init?: RequestInit): string => (typeof init?.body === "string" ? init.body : "");

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

afterEach(cleanupTempDirs);

describe("BraviaClient.rpc", () => {
  test("builds the JSON-RPC request with auth headers", async () => {
    const { calls, fetchLike } = mockFetch(() => json({ result: [{ status: "active" }] }));
    const tv = new BraviaClient({ baseUrl: "http://tv", credentials: await store("psk-1"), fetch: fetchLike });
    const r = await tv.rpc("system", "getPowerStatus");
    expect(r.result?.[0]).toEqual({ status: "active" });

    expect(calls).toHaveLength(1);
    const { url, init } = firstCall(calls);
    expect(url).toBe("http://tv/sony/system");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    expect(JSON.parse(bodyOf(init))).toEqual({
      method: "getPowerStatus",
      params: [],
      id: 1,
      version: "1.0",
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Auth-PSK")).toBe("psk-1");
  });

  test("includes saved credential and cookie headers", async () => {
    const s = await CredentialStore.open(await tempFile(), { clientId: "c", nickname: "n", psk: null });
    await s.setRegistration("Basic xyz", "a=b");
    const seen: RequestInit[] = [];
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: s,
      fetch: (_url, init) => {
        seen.push(init ?? {});
        return Promise.resolve(json({ result: [] }));
      },
    });
    await tv.rpc("system", "getPowerStatus");
    const headers = new Headers(seen[0]?.headers);
    expect(headers.get("authorization")).toBe("Basic xyz");
    expect(headers.get("cookie")).toBe("a=b");
  });

  test("pskOverride replaces the stored PSK", async () => {
    const seen: RequestInit[] = [];
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store("stored"),
      fetch: (_url, init) => {
        seen.push(init ?? {});
        return Promise.resolve(json({ result: [] }));
      },
    });
    await tv.rpc("system", "m", [], "override");
    expect(new Headers(seen[0]?.headers).get("x-auth-psk")).toBe("override");
  });

  test("maps transport failure to 504", async () => {
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => Promise.reject(new Error("boom")),
    });
    expect(await tv.rpc("system", "m")).toEqual({ error: [504, "TV unreachable"] });
  });

  test("maps non-JSON responses to the real HTTP status", async () => {
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => Promise.resolve(new Response("<html>403</html>", { status: 403, statusText: "Forbidden" })),
    });
    expect(await tv.rpc("system", "m")).toEqual({ error: [403, "Forbidden"] });
  });

  test("normalizes malformed RPC payloads", async () => {
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => Promise.resolve(json({ error: [7, "not available"] })),
    });
    const r = await tv.rpc("avContent", "m");
    expect(r.error).toEqual([7, "not available"]);
    expect(r.result).toBeUndefined();
  });
});

describe("BraviaClient.sendKey", () => {
  test("sends SOAP with SOAPACTION and reports success", async () => {
    const { calls, fetchLike } = mockFetch(() => new Response("", { status: 200 }));
    const tv = new BraviaClient({ baseUrl: "http://tv", credentials: await store(), fetch: fetchLike });
    expect(await tv.sendKey("AAAAAA==")).toEqual({ ok: true });

    const { url, init } = firstCall(calls);
    expect(url).toBe("http://tv/sony/IRCC");
    expect(init?.redirect).toBe("manual");
    expect(bodyOf(init)).toContain("<IRCCCode>AAAAAA==</IRCCCode>");
    const headers = new Headers(init?.headers);
    expect(headers.get("SOAPACTION")).toBe('"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"');
  });

  test("extracts faultstring from a SOAP fault", async () => {
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => Promise.resolve(new Response("<faultstring>Rejected</faultstring>", { status: 500 })),
    });
    const r = await tv.sendKey("X");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("Rejected");
      expect(r.status).toBe(500);
    }
  });

  test("surfaces a JSON error body when the TV answers in JSON", async () => {
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => Promise.resolve(json({ error: [7, "nope"] }, { status: 400 })),
    });
    const r = await tv.sendKey("X");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toEqual([7, "nope"]);
  });

  test("marks generic SOAP faults as unsupported", async () => {
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => Promise.resolve(new Response("<s:Fault/>", { status: 200 })),
    });
    const r = await tv.sendKey("X");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unsupported");
  });

  test("maps transport failure to status 504", async () => {
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => Promise.reject(new Error("offline")),
    });
    const r = await tv.sendKey("X");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(504);
  });
});

describe("BraviaClient pairing", () => {
  test("startRegistration sends actRegister with client identity", async () => {
    const { calls, fetchLike } = mockFetch(() => json({ error: [40003, "show key"] }));
    const tv = new BraviaClient({ baseUrl: "http://tv", credentials: await store(), fetch: fetchLike });
    await tv.startRegistration("tester");
    const body = JSON.parse(bodyOf(calls[0]?.init)) as { method: string; params: unknown[] };
    expect(body.method).toBe("actRegister");
    expect(body.params[0]).toEqual({ clientid: "test-client", nickname: "tester", level: "private" });
  });

  test("confirmRegistration stores credentials on success", async () => {
    const s = await CredentialStore.open(await tempFile(), { clientId: "c", nickname: "n", psk: null });
    const { calls, fetchLike } = mockFetch(
      () =>
        new Response(JSON.stringify({ result: [""] }), {
          headers: { "content-type": "application/json", authorization: "Basic issued", "set-cookie": "ck=1" },
        }),
    );
    const tv = new BraviaClient({ baseUrl: "http://tv", credentials: s, fetch: fetchLike });
    expect(await tv.confirmRegistration("1234", "n")).toEqual({ ok: true });
    expect(s.snapshot.credential).toBe("Basic issued");
    expect(s.snapshot.cookie).toBe("ck=1");
    expect(s.paired).toBe(true);

    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("Authorization")).toBe(`Basic ${Buffer.from(":1234").toString("base64")}`);
    expect((JSON.parse(bodyOf(calls[0]?.init)) as { method: string }).method).toBe("actRegister");
  });

  test("confirmRegistration reports the TV error code on failure", async () => {
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => Promise.resolve(json({ error: [7, "auth failed"] }, { status: 401 })),
    });
    expect(await tv.confirmRegistration("9999", "n")).toEqual({ ok: false, code: 7 });
  });

  test("confirmRegistration falls back to the HTTP status without a TV error", async () => {
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => Promise.resolve(new Response("nope", { status: 500 })),
    });
    expect(await tv.confirmRegistration("9999", "n")).toEqual({ ok: false, code: 500 });
  });

  test("confirmRegistration maps a transport failure to 504", async () => {
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => Promise.reject(new Error("offline")),
    });
    expect(await tv.confirmRegistration("1234", "n")).toEqual({ ok: false, code: 504 });
  });

  test("probePsk passes the override and reports result presence", async () => {
    const { calls, fetchLike } = mockFetch(() => json({ result: [{ model: "X" }] }));
    const tv = new BraviaClient({ baseUrl: "http://tv", credentials: await store("stored"), fetch: fetchLike });
    const probe = await tv.probePsk("candidate");
    expect(probe.result).toBeDefined();
    expect(new Headers(calls[0]?.init?.headers).get("X-Auth-PSK")).toBe("candidate");
  });

  test("probePsk does not reuse stored normal-mode credentials", async () => {
    const s = await CredentialStore.open(await tempFile(), { clientId: "c", nickname: "n", psk: null });
    await s.setRegistration("Basic stored", "ck=stored");
    const { calls, fetchLike } = mockFetch(() => json({ result: [{ model: "X" }] }));
    const tv = new BraviaClient({ baseUrl: "http://tv", credentials: s, fetch: fetchLike });
    await tv.probePsk("candidate");
    const headers = new Headers(firstCall(calls).init?.headers);
    expect(headers.get("X-Auth-PSK")).toBe("candidate");
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Cookie")).toBeNull();
  });

  test("probePsk reports absent result on rejection", async () => {
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => Promise.resolve(json({ error: [403, "psk mismatch"] }, { status: 403 })),
    });
    const probe = await tv.probePsk("bad");
    expect(probe.result).toBeUndefined();
    expect(probe.error).toEqual([403, "psk mismatch"]);
  });
});

describe("BraviaClient transport logging", () => {
  let restore = () => {};

  /** Record warn/info lines (level-prefixed) instead of printing them. */
  const captureLogs = (): string[] => {
    const lines: string[] = [];
    const record =
      (level: string) =>
      (...args: unknown[]) => {
        lines.push(`${level} ${args.join(" ")}`);
      };
    const warn = spyOn(console, "warn").mockImplementation(record("warn"));
    const info = spyOn(console, "info").mockImplementation(record("info"));
    restore = () => {
      warn.mockRestore();
      info.mockRestore();
    };
    return lines;
  };

  afterEach(() => restore());

  const offline = () => Promise.reject(new Error("offline"));

  test("logs one line for repeated failures on the same method", async () => {
    const lines = captureLogs();
    const tv = new BraviaClient({ baseUrl: "http://tv", credentials: await store(), fetch: offline });
    await tv.rpc("system", "getPowerStatus");
    await tv.rpc("system", "getPowerStatus");
    expect(lines).toEqual([
      "warn bravia: TV rpc system/getPowerStatus failed: offline (repeats suppressed until recovery)",
    ]);
  });

  test("logs one recovery line after a failure streak", async () => {
    const lines = captureLogs();
    let up = false;
    const tv = new BraviaClient({
      baseUrl: "http://tv",
      credentials: await store(),
      fetch: () => (up ? Promise.resolve(json({ result: [] })) : offline()),
    });
    await tv.rpc("system", "getPowerStatus");
    await tv.rpc("system", "getPowerStatus");
    up = true;
    await tv.rpc("system", "getPowerStatus");
    await tv.rpc("system", "getPowerStatus");
    expect(lines).toEqual([
      "warn bravia: TV rpc system/getPowerStatus failed: offline (repeats suppressed until recovery)",
      "info bravia: TV rpc system/getPowerStatus reachable again",
    ]);
  });

  test("tracks different service/method keys independently", async () => {
    const lines = captureLogs();
    const tv = new BraviaClient({ baseUrl: "http://tv", credentials: await store(), fetch: offline });
    await tv.rpc("system", "getPowerStatus");
    await tv.rpc("system", "getPowerStatus");
    await tv.rpc("system", "getRemoteControllerInfo");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("rpc system/getPowerStatus failed");
    expect(lines[1]).toContain("rpc system/getRemoteControllerInfo failed");
  });

  test("suppresses repeated IRCC failures separately from JSON-RPC", async () => {
    const lines = captureLogs();
    const tv = new BraviaClient({ baseUrl: "http://tv", credentials: await store(), fetch: offline });
    expect((await tv.sendKey("X")).ok).toBe(false);
    expect((await tv.sendKey("X")).ok).toBe(false);
    await tv.rpc("system", "getPowerStatus");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("TV ircc sendKey failed: offline");
    expect(lines[1]).toContain("TV rpc system/getPowerStatus failed: offline");
  });
});
