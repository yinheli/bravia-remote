import { afterEach, describe, expect, test } from "bun:test";
import {
  backApp,
  fetchAuthStatus,
  fetchCodes,
  fetchScreenshot,
  launchApp,
  loginWithToken,
  onUnauthorized,
  type ShotFailure,
  sendKeyCode,
  shotFailureText,
  startPairing,
  submitPin,
  verifyPsk,
} from "./api";
import { t } from "./i18n";

type FetchMock = (url: string, init?: RequestInit) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[] = [];

const stubFetch = (handler: FetchMock): void => {
  calls = [];
  const mock = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  // Test stub for the fetch boundary; fetch's static members are unused here.
  globalThis.fetch = mock as unknown as typeof fetch;
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const bodyText = (init?: RequestInit): string => (typeof init?.body === "string" ? init.body : "");

describe("auth requests", () => {
  test("maps /api/auth modes with same-origin credentials", async () => {
    stubFetch(() => json({ ok: true, mode: "token" }));
    expect(await fetchAuthStatus()).toEqual({ ok: true, mode: "token" });
    expect(calls[0]?.init?.credentials).toBe("same-origin");
  });

  test("posts the token and relies on the session cookie", async () => {
    stubFetch(() => json({ ok: true, mode: "token" }));
    expect(await loginWithToken("test-token")).toBe("ok");
    const init = calls[0]?.init;
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    expect(new Headers(init?.headers).get("content-type")).toContain("application/json");
    expect(JSON.parse(bodyText(init))).toEqual({ token: "test-token" });
  });

  test("maps 401 to unauthorized and network failure to unreachable", async () => {
    stubFetch(() => json({ ok: false, error: ["unauthorized"] }, 401));
    expect(await fetchAuthStatus()).toBe("unauthorized");
    expect(await loginWithToken("bad-token")).toBe("rejected");
    stubFetch(() => Promise.reject(new Error("offline")));
    expect(await fetchAuthStatus()).toBe("unreachable");
  });

  test("login separates a wrong token from transport and server failures", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    expect(await loginWithToken("correct-token")).toBe("unreachable");

    stubFetch(() => json({ ok: false, error: ["unknown"] }, 503));
    expect(await loginWithToken("correct-token")).toBe("unreachable");

    // POST accepted, but the cookie probe cannot reach the server.
    let n = 0;
    stubFetch(() => (++n === 1 ? json({ ok: true, mode: "token" }) : Promise.reject(new Error("offline"))));
    expect(await loginWithToken("correct-token")).toBe("unreachable");

    // POST accepted, but the browser did not keep the session cookie.
    let m = 0;
    stubFetch(() =>
      ++m === 1 ? json({ ok: true, mode: "token" }) : json({ ok: false, error: ["unauthorized"] }, 401),
    );
    expect(await loginWithToken("correct-token")).toBe("rejected");
  });

  test("screenshot fetches use same-origin cookies", async () => {
    stubFetch(() => new Response(new Uint8Array(1200), { headers: { "content-type": "image/png" } }));
    const shot = await fetchScreenshot();
    expect(shot.ok).toBe(true);
    expect(calls[0]?.init?.credentials).toBe("same-origin");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBeNull();
  });
});

describe("session expiry", () => {
  test("protected 401s notify subscribers; login 401s and unsubscribed handlers do not", async () => {
    const events: string[] = [];
    const off = onUnauthorized(() => events.push("expired"));
    try {
      stubFetch(() => json({ ok: false, error: ["unauthorized"] }, 401));
      await sendKeyCode("AAAAAA==");
      expect(events).toHaveLength(1);

      // The login endpoint's 401 means "wrong token", not "expired session".
      await loginWithToken("wrong-token");
      expect(events).toHaveLength(1);

      // Screenshots use their own fetch path and must report expiry too.
      stubFetch(() => json({ ok: false, error: ["unauthorized"] }, 401));
      await fetchScreenshot();
      expect(events).toHaveLength(2);

      off();
      stubFetch(() => json({ ok: false }, 401));
      await sendKeyCode("AAAAAA==");
      expect(events).toHaveLength(2);
    } finally {
      off();
    }
  });

  test("a TV-side 401 on /api/key is a send failure, not session expiry", async () => {
    const events: string[] = [];
    const off = onUnauthorized(() => events.push("expired"));
    try {
      // IRCC with stale registration credentials: the route forwards the TV's
      // 401 status, but the body is not the server auth layer's rejection.
      stubFetch(() => json({ ok: false, error: ["auth"] }, 401));
      expect(await sendKeyCode("AAAAAA==")).toEqual({ ok: false, msg: t("errPairingNeeded") });
      expect(events).toHaveLength(0);

      // A non-auth body on the screenshot path is a shot failure too.
      stubFetch(() => json({ ok: false, error: "timeout" }, 401));
      expect(await fetchScreenshot()).toEqual({ ok: false, code: "timeout", bytes: undefined });
      expect(events).toHaveLength(0);

      // The real server-auth 401 still expires the session.
      stubFetch(() => json({ ok: false, error: ["unauthorized"] }, 401));
      await sendKeyCode("AAAAAA==");
      expect(events).toHaveLength(1);
    } finally {
      off();
    }
  });
});

describe("pair outcome mapping", () => {
  test("startPairing: network failure fails with the localized connect message", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    const o = await startPairing();
    expect(o.stage).toBe("fail");
    expect(o.message).toBe(t("errConnectTv"));
  });

  test("startPairing: non-JSON HTTP error keeps the status message", async () => {
    stubFetch(() => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    const o = await startPairing();
    expect(o.stage).toBe("fail");
    expect(o.message).toBe(t("errHttp", { status: 502 }));
  });

  test("startPairing: needKey response maps to the first-run message", async () => {
    stubFetch(() => json({ ok: false, needKey: true, code: 40003 }));
    const o = await startPairing();
    expect(o.stage).toBe("needKey");
    expect(o.message).toBe(t("pairNeedKeyFirst"));
  });

  test("startPairing: TV standby code maps to the standby message", async () => {
    stubFetch(() => json({ ok: false, error: [40005, "standby"] }));
    const o = await startPairing();
    expect(o.stage).toBe("fail");
    expect(o.message).toBe(t("pairStandby"));
  });

  test("startPairing: known TV codes localize through errText", async () => {
    stubFetch(() => json({ ok: false, error: [7, "nope"] }));
    const o = await startPairing();
    expect(o.stage).toBe("fail");
    expect(o.message).toBe(t("errNoContent"));
  });

  test("submitPin: wrong key maps to the retry message", async () => {
    stubFetch(() => json({ ok: false, needKey: true, code: 401 }));
    const o = await submitPin("9999");
    expect(o.stage).toBe("needKey");
    expect(o.message).toBe(t("pairNeedKeyRetry"));
  });

  test("submitPin: a 403 challenge still asks for the current key", async () => {
    stubFetch(() => json({ ok: false, needKey: true, code: 403 }));
    const o = await submitPin("9999");
    expect(o.stage).toBe("needKey");
    expect(o.message).toBe(t("pairNeedKeyRetry"));
  });

  test("submitPin: a transport failure is not a wrong-key challenge", async () => {
    stubFetch(() => json({ ok: false, needKey: true, code: 504 }));
    const o = await submitPin("1234");
    expect(o.stage).toBe("fail");
    expect(o.message).toBe(t("errConnectTv"));
  });

  test("submitPin: a TV 5xx is not a wrong-key challenge", async () => {
    stubFetch(() => json({ ok: false, needKey: true, code: 500 }));
    const o = await submitPin("1234");
    expect(o.stage).toBe("fail");
    expect(o.message).toBe(t("errUnavailable", { code: 500 }));
  });

  test("submitPin: the server's transport error shape maps to the connect message", async () => {
    stubFetch(() => json({ ok: false, error: [504, "TV unreachable"] }));
    const o = await submitPin("1234");
    expect(o.stage).toBe("fail");
    expect(o.message).toBe(t("errConnectTv"));
  });

  test("verifyPsk: auth rejection maps to pskInvalid", async () => {
    stubFetch(() => json({ ok: false, error: ["auth"] }, 403));
    const o = await verifyPsk("bad");
    expect(o.stage).toBe("fail");
    expect(o.message).toBe(t("pskInvalid"));
  });

  test("verifyPsk: unreachable TV localizes the 504 transport code", async () => {
    stubFetch(() => json({ ok: false, error: [504, "TV unreachable"] }, 504));
    const o = await verifyPsk("whatever");
    expect(o.stage).toBe("fail");
    expect(o.message).toBe(t("errConnectTv"));
  });

  test("verifyPsk: success reports ok with the PSK message", async () => {
    stubFetch(() => json({ ok: true, paired: true, mode: "psk" }));
    const o = await verifyPsk("good");
    expect(o.stage).toBe("ok");
    expect(o.message).toBe(t("pairOkPsk"));
  });
});

describe("key + app mapping", () => {
  test("sendKeyCode: success", async () => {
    stubFetch(() => json({ ok: true }));
    expect(await sendKeyCode("AAAAAA==")).toEqual({ ok: true });
    expect(calls[0]?.url).toBe("/api/key");
  });

  test("sendKeyCode: server CSRF rejection localizes errForbidden", async () => {
    stubFetch(() => json({ ok: false, error: ["forbidden"] }, 403));
    const r = await sendKeyCode("AAAAAA==");
    expect(r.msg).toBe(t("errForbidden"));
  });

  test("sendKeyCode: TV 403 keeps the pairing-needed message", async () => {
    stubFetch(() => json({ ok: false, error: [403, "auth"] }, 403));
    const r = await sendKeyCode("AAAAAA==");
    expect(r.msg).toBe(t("errPairingNeeded"));
  });

  test("sendKeyCode: unsupported-fault string localizes irccUnsupported", async () => {
    stubFetch(() => json({ ok: false, error: "unsupported" }, 500));
    const r = await sendKeyCode("AAAAAA==");
    expect(r.msg).toBe(t("irccUnsupported"));
  });

  test("sendKeyCode: numeric TV error localizes standby instead of raw code", async () => {
    stubFetch(() => json({ ok: false, error: [40005, "standby"] }, 500));
    const r = await sendKeyCode("AAAAAA==");
    expect(r.msg).toBe(t("errStandby"));
  });

  test("backApp: none code maps to errNoPrevApp", async () => {
    stubFetch(() => json({ ok: false, error: ["none"] }));
    const r = await backApp();
    expect(r.msg).toBe(t("errNoPrevApp"));
  });

  test("launchApp: 5xx body carrying ok:true is still a failure", async () => {
    stubFetch(() => json({ ok: true }, 500));
    const r = await launchApp("app.a");
    expect(r.ok).toBe(false);
  });

  test("launchApp: network failure maps to errConnectServer", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    const r = await launchApp("app.a");
    expect(r.msg).toBe(t("errConnectServer"));
  });

  test("non-JSON HTTP errors keep the status and localize errHttp", async () => {
    stubFetch(
      () =>
        new Response("<html>boom</html>", {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "content-type": "text/html" },
        }),
    );
    expect(await sendKeyCode("AAAAAA==")).toEqual({ ok: false, msg: t("errHttp", { status: 500 }) });
    expect(await launchApp("app.a")).toEqual({ ok: false, msg: t("errHttp", { status: 500 }) });
    // Valid JSON error bodies still take precedence over the generic text.
    stubFetch(() => json({ ok: false, error: [40005, "standby"] }, 500));
    expect((await sendKeyCode("AAAAAA==")).msg).toBe(t("errStandby"));
  });
});

describe("codes parsing", () => {
  test("an error envelope is a retryable failure; an empty list is a real result", async () => {
    stubFetch(() => json({ error: [40005, "standby"] }));
    expect(await fetchCodes()).toBeUndefined();
    stubFetch(() => json([]));
    expect(await fetchCodes()).toEqual({});
  });
});

describe("screenshot failures", () => {
  const failureOf = async (): Promise<ShotFailure> => {
    const r = await fetchScreenshot();
    if (r.ok) throw new Error("expected failure");
    return r;
  };

  test("fetch rejection maps to the network code and localized text", async () => {
    stubFetch(() => Promise.reject(new Error("offline")));
    const f = await failureOf();
    expect(f).toEqual({ ok: false, code: "network" });
    expect(shotFailureText(f)).toBe(t("errConnectServer"));
  });

  test("a central forbidden 403 keeps the machine code and localizes", async () => {
    stubFetch(() => json({ ok: false, error: ["forbidden"] }, 403));
    const f = await failureOf();
    expect(f).toEqual({ ok: false, code: "forbidden", bytes: undefined });
    expect(shotFailureText(f)).toBe(t("errForbidden"));
  });

  test("server machine codes localize through shotFailureText", async () => {
    stubFetch(() => json({ ok: false, error: "timeout", bytes: null }, 502));
    expect(shotFailureText(await failureOf())).toBe(t("shotTimeout"));
    stubFetch(() => json({ ok: false, error: "too-small", bytes: 4 }, 502));
    expect(shotFailureText(await failureOf())).toBe(t("shotTooSmall", { bytes: 4 }));
    stubFetch(() => json({ ok: false, error: "adb-missing", bytes: null }, 502));
    expect(shotFailureText(await failureOf())).toBe(t("adbMissing"));
    stubFetch(() => json({ ok: false, error: "screencap-failed", bytes: null }, 502));
    expect(shotFailureText(await failureOf())).toBe(t("shotScreencapFailed"));
    // A non-JSON error body is an HTTP failure, not a protocol rejection: the
    // status text becomes the code and the unknown-code branch still renders.
    stubFetch(() => new Response("<html>boom</html>", { status: 500, statusText: "Internal Server Error" }));
    expect(await failureOf()).toEqual({ ok: false, code: "Internal Server Error" });
    expect(shotFailureText({ ok: false, code: "weird" })).toBe(t("shotFailed", { text: "weird" }));
  });
});
