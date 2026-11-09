/** Typed fetch wrappers; wire responses are parsed and errors localized here. */
import {
  type AuthResult,
  isPairChallengeCode,
  type PairActionResult,
  type PairStatus,
  parseAuthResult,
  parseCodeInfos,
  parseCustomApps,
  parseOkResult,
  parsePairActionResult,
  parsePairStatus,
  parseScreenError,
} from "../shared/api";
import {
  type ApiError,
  type InfoPayload,
  parseApiError,
  parseInfoPayload,
  parsePowerStatus,
  parseRpcResponse,
} from "../shared/bravia";
import { t } from "./i18n";
import type { CustomApp } from "./keys";
import { errText } from "./parse";

type ApiResponse = { status: number; statusText: string; body: unknown };

/** Client-side cap so a wedged server cannot leave buttons pending forever. */
const API_TIMEOUT_MS = 8000;

const LEGACY_TOKEN_KEY = "bravia-remote.token";
try {
  if (typeof window !== "undefined") window.localStorage.removeItem(LEGACY_TOKEN_KEY);
} catch {
  // Ignore storage errors (disabled/private mode).
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Subscribe to session expiry (server auth 401); returns unsubscribe. */
export const onUnauthorized = (listener: UnauthorizedListener): (() => void) => {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
};

const notifyUnauthorized = (): void => {
  for (const listener of unauthorizedListeners) listener();
};

/**
 * Only the server's own auth layer answers 401 with
 * `{ ok: false, error: ["unauthorized"] }`. Routes also forward TV HTTP
 * statuses (an IRCC 401 from stale registration credentials), which are
 * ordinary send failures, not web-session expiry. The login endpoint's 401
 * means "wrong token", so it is excluded too.
 */
const isSessionExpiry = (url: string, status: number, body: unknown): boolean => {
  if (status !== 401 || url === "/api/auth") return false;
  return parseApiError(parseOkResult(body).error)?.[0] === "unauthorized";
};

const request = async (url: string, init?: RequestInit): Promise<ApiResponse> => {
  let r: Response;
  try {
    r = await fetch(url, {
      ...init,
      credentials: "same-origin",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    return { status: 0, statusText: "", body: undefined };
  }
  let body: unknown;
  try {
    body = (await r.json()) as unknown;
  } catch {
    // A non-JSON body (reverse-proxy or Bun.serve HTML error page) is still a
    // completed HTTP response: keep the status so callers report it as such.
    body = undefined;
  }
  if (isSessionExpiry(url, r.status, body)) notifyUnauthorized();
  return { status: r.status, statusText: r.statusText, body };
};

export type AuthState = AuthResult | "unauthorized" | "unreachable";

/** Ask the server which auth mode it uses; 401 means a token login is required. */
export const fetchAuthStatus = async (): Promise<AuthState> => {
  const { status, body } = await request("/api/auth");
  if (status === 0) return "unreachable";
  if (status === 401) return "unauthorized";
  return parseAuthResult(body) ?? "unreachable";
};

export type LoginResult = "ok" | "rejected" | "unreachable";

/** Exchange a token for an HttpOnly session cookie. */
export const loginWithToken = async (token: string): Promise<LoginResult> => {
  const { status, body } = await request("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  // No HTTP response (server down/timeout), a server-side failure, or a
  // malformed success body is a connection problem, not a wrong token.
  if (status === 0 || status >= 500) return "unreachable";
  if (status >= 400) return "rejected";
  if (!parseAuthResult(body)) return "unreachable";
  // Verify the browser accepted the cookie before entering the app.
  const state = await fetchAuthStatus();
  if (state === "unreachable") return "unreachable";
  return state === "unauthorized" ? "rejected" : "ok";
};

const postJson = (url: string, body: unknown): Promise<ApiResponse> =>
  request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const fetchPairStatus = async (): Promise<PairStatus | undefined> =>
  parsePairStatus((await request("/api/pair")).body);

type PairStage = "ok" | "needKey" | "fail";
export type PairOutcome = { stage: PairStage; message: string };

type PairFlow = { okMessage: string; needKeyMessage: string; pskMode: boolean };

const toPairOutcome = (status: number, body: unknown, flow: PairFlow): PairOutcome => {
  if (status === 0) return { stage: "fail", message: t("errConnectTv") };
  // Non-JSON error page (proxy/Bun): report the HTTP status, not a fake TV code.
  if (body === undefined && status >= 400) return { stage: "fail", message: t("errHttp", { status }) };
  const result: PairActionResult = parsePairActionResult(body);
  if (status < 400 && result.paired === true) return { stage: "ok", message: flow.okMessage };
  if (result.needKey === true) {
    // `needKey` is meaningful only alongside a TV auth code. A transport
    // failure (504) or server error must not be reported as a wrong PIN.
    if (isPairChallengeCode(result.code)) return { stage: "needKey", message: flow.needKeyMessage };
    return {
      stage: "fail",
      message: result.code === undefined ? t("errConnectTv") : errText([result.code, ""]),
    };
  }
  const err = result.error;
  const code = err?.[0];
  const text = err?.[1];
  const tvText = localizedTvError(err);
  const message = flow.pskMode
    ? code === "auth"
      ? t("pskInvalid")
      : (tvText ?? t("pairPskFailed", { code: String(code), text: text || t("pskVerifyFailed") }))
    : code === 40005 || /turn/i.test(text ?? "")
      ? t("pairStandby")
      : (tvText ?? t("pairFailed", { code: String(code), text: text ?? "" }));
  return { stage: "fail", message };
};

/** Ask the TV to show the 4-digit registration key (Normal mode). */
export const startPairing = async (nickname?: string): Promise<PairOutcome> => {
  const { status, body } = await postJson("/api/pair", nickname ? { nickname } : {});
  return toPairOutcome(status, body, {
    okMessage: t("pairOkPin"),
    needKeyMessage: t("pairNeedKeyFirst"),
    pskMode: false,
  });
};

/** Submit the on-screen registration key. */
export const submitPin = async (pin: string): Promise<PairOutcome> => {
  const { status, body } = await postJson("/api/pair", { key: pin });
  return toPairOutcome(status, body, {
    okMessage: t("pairOkPin"),
    needKeyMessage: t("pairNeedKeyRetry"),
    pskMode: false,
  });
};

/** Validate and persist a pre-shared key (PSK mode). */
export const verifyPsk = async (psk: string): Promise<PairOutcome> => {
  const { status, body } = await postJson("/api/pair", { psk });
  return toPairOutcome(status, body, {
    okMessage: t("pairOkPsk"),
    needKeyMessage: "",
    pskMode: true,
  });
};

/** Localized text for a numeric TV protocol error; undefined for app codes. */
const localizedTvError = (err: ApiError | undefined): string | undefined => {
  if (!err || typeof err[0] !== "number") return undefined;
  return errText(err) || undefined;
};

/**
 * Shared success gate for the `{ ok }` endpoints (/api/key, /api/app):
 * HTTP 2xx/3xx *and* the body's `ok` flag. Server routes always set `ok`, so a
 * 5xx body carrying `ok:true` must never count as success. (/api/pair keys
 * success off `paired` with the same status bound.)
 */
const isApiSuccess = (status: number, body: unknown): boolean => status > 0 && status < 400 && parseOkResult(body).ok;

export type SendResult = { ok: boolean; msg?: string };

export const sendKeyCode = async (code: string): Promise<SendResult> => {
  const { status, statusText, body } = await postJson("/api/key", { code });
  if (status === 0) return { ok: false, msg: t("errConnectServer") };
  if (isApiSuccess(status, body)) return { ok: true };
  const { error } = parseOkResult(body);
  const err = parseApiError(error);
  if (err?.[0] === "forbidden") return { ok: false, msg: t("errForbidden") };
  if (status === 403 || err?.[0] === "auth") return { ok: false, msg: t("errPairingNeeded") };
  if (err) {
    const tvText = localizedTvError(err);
    return { ok: false, msg: tvText ?? t("errSendCode", { code: err[0], text: err[1] }) };
  }
  if (typeof error === "string") return { ok: false, msg: error === "unsupported" ? t("irccUnsupported") : error };
  return { ok: false, msg: t("errHttp", { status: status || statusText }) };
};

export type AppActionBody = { uri?: string; back?: boolean };

const postApp = async (payload: AppActionBody): Promise<SendResult> => {
  const { status, statusText, body } = await postJson("/api/app", payload);
  if (status === 0) return { ok: false, msg: t("errConnectServer") };
  if (isApiSuccess(status, body)) return { ok: true };
  const err = parseApiError(parseOkResult(body).error);
  if (err?.[0] === "none") return { ok: false, msg: t("errNoPrevApp") };
  const tvText = localizedTvError(err);
  if (!err && body === undefined) return { ok: false, msg: t("errHttp", { status: status || statusText }) };
  return { ok: false, msg: tvText ?? t("toastActionFailedCode", { code: String(err?.[0] ?? "?") }) };
};

export const launchApp = (uri: string): Promise<SendResult> => postApp({ uri });
export const backApp = (): Promise<SendResult> => postApp({ back: true });

export type PowerStatus = "active" | "standby";

/** Power status for the header dot; null when the TV/server is unreachable. */
export const fetchPowerStatus = async (): Promise<PowerStatus | null> => {
  const status = parsePowerStatus(parseRpcResponse((await request("/api/status")).body).result?.[0])?.status;
  return status === "active" || status === "standby" ? status : null;
};

/** Typed /api/info payload. */
export const fetchInfo = async (): Promise<InfoPayload | undefined> =>
  parseInfoPayload((await request("/api/info")).body);

/** Custom app buttons (BRAVIA_APPS on the server); undefined when the request failed. */
export const fetchWebConfig = async (): Promise<CustomApp[] | undefined> =>
  parseCustomApps((await request("/api/config")).body);

/** Live IRCC codes from the TV, merged over STANDARD_IRCC_CODES by the caller. */
export const fetchCodes = async (): Promise<Record<string, string> | undefined> => {
  const { body } = await request("/api/codes");
  if (!Array.isArray(body)) return undefined;
  const map: Record<string, string> = {};
  for (const info of parseCodeInfos(body)) map[info.name] = info.code;
  return map;
};

export type ShotFailure = { ok: false; code: string; bytes?: number };
export type ShotResult = { ok: true; blob: Blob } | ShotFailure;

/**
 * Network failure maps to the "network" code; a non-JSON error body (proxy or
 * Bun.serve HTML page) falls back to the HTTP status text instead of throwing.
 */
export const fetchScreenshot = async (): Promise<ShotResult> => {
  let r: Response;
  try {
    r = await fetch("/api/screen", { credentials: "same-origin", signal: AbortSignal.timeout(20_000) });
  } catch {
    return { ok: false, code: "network" };
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => undefined)) as unknown;
    if (isSessionExpiry("/api/screen", r.status, body)) notifyUnauthorized();
    const parsed = parseScreenError(body);
    return { ok: false, code: parsed.code ?? (r.statusText || String(r.status)), bytes: parsed.bytes };
  }
  return { ok: true, blob: await r.blob() };
};

/** Localize a screenshot failure code for display. */
export const shotFailureText = (f: ShotFailure): string =>
  f.code === "timeout"
    ? t("shotTimeout")
    : f.code === "too-small"
      ? t("shotTooSmall", { bytes: f.bytes ?? 0 })
      : f.code === "adb-missing"
        ? t("adbMissing")
        : f.code === "screencap-failed"
          ? t("shotScreencapFailed")
          : f.code === "forbidden"
            ? t("errForbidden")
            : f.code === "network"
              ? t("errConnectServer")
              : t("shotFailed", { text: f.code });
