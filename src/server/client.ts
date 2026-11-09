/**
 * Thin client for the Sony Bravia "Simple IP Control" REST API: JSON-RPC style
 * POSTs to /sony/{service}, the IRCC SOAP endpoint for remote-control keys,
 * and the accessControl pairing flow.
 *
 * The fetch implementation is injectable so tests can run against a mock.
 */
import { parseOkResult } from "../shared/api";
import { type ApiError, parseRpcResponse, type RpcResponse } from "../shared/bravia";
import type { CredentialStore } from "./credentials";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type IrccResult = { ok: true } | { ok: false; error: ApiError | string; status: number };
export type RegistrationResult = { ok: true } | { ok: false; code?: number };

export class BraviaClient {
  /** Registration requests (waiting for the on-screen PIN) get a longer timeout. */
  static readonly PAIR_TIMEOUT_MS = 5000;

  readonly #baseUrl: string;
  readonly #credentials: CredentialStore;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  /** Transport-failure keys already logged; repeats stay quiet until recovery. */
  readonly #unreachable = new Set<string>();

  constructor(options: {
    baseUrl: string;
    credentials: CredentialStore;
    timeoutMs?: number;
    fetch?: FetchLike;
  }) {
    this.#baseUrl = options.baseUrl;
    this.#credentials = options.credentials;
    this.#timeoutMs = options.timeoutMs ?? 4000;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  #authHeaders(pskOverride?: string, includeRegistration = true): Record<string, string> {
    const { credential, cookie, psk } = this.#credentials.snapshot;
    const activePsk = pskOverride ?? psk;
    return {
      ...(includeRegistration && credential && { Authorization: credential }),
      ...(includeRegistration && cookie && { Cookie: cookie }),
      ...(activePsk ? { "X-Auth-PSK": activePsk } : {}),
    };
  }

  /**
   * Log the first transport failure for `key` only. The web UI polls status
   * every few seconds, so an offline TV would otherwise log once per poll.
   */
  #transportFailed(key: string, error: unknown): void {
    if (this.#unreachable.has(key)) return;
    this.#unreachable.add(key);
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`bravia: TV ${key} failed: ${detail} (repeats suppressed until recovery)`);
  }

  /** Close out a failure streak with one recovery line, even if repeats were hidden. */
  #transportSucceeded(key: string): void {
    if (!this.#unreachable.delete(key)) return;
    console.info(`bravia: TV ${key} reachable again`);
  }

  /**
   * POST one JSON-RPC method to a Bravia service. Transport failures map to
   * `{ error: [504, "TV unreachable"] }`; a non-JSON response body maps to the
   * actual HTTP status instead of being masked.
   */
  async rpc(
    service: string,
    method: string,
    params: unknown[] = [],
    pskOverride?: string,
    includeRegistration = true,
  ): Promise<RpcResponse> {
    let r: Response;
    try {
      r = await this.#fetch(`${this.#baseUrl}/sony/${service}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.#authHeaders(pskOverride, includeRegistration) },
        body: JSON.stringify({ method, params, id: 1, version: "1.0" }),
        redirect: "manual",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (e) {
      this.#transportFailed(`rpc ${service}/${method}`, e);
      return { error: [504, "TV unreachable"] };
    }
    this.#transportSucceeded(`rpc ${service}/${method}`);
    try {
      return parseRpcResponse((await r.json()) as unknown);
    } catch {
      return { error: [r.status, r.statusText] };
    }
  }

  /** Send one remote-control key over IRCC (SOAP). */
  async sendKey(code: string): Promise<IrccResult> {
    const soap =
      `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"` +
      ` s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>` +
      `<u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1">` +
      `<IRCCCode>${code}</IRCCCode></u:X_SendIRCC></s:Body></s:Envelope>`;
    try {
      const r = await this.#fetch(`${this.#baseUrl}/sony/IRCC`, {
        method: "POST",
        headers: {
          "content-type": "text/xml; charset=UTF-8",
          SOAPACTION: '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"',
          ...this.#authHeaders(),
        },
        body: soap,
        redirect: "manual",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      this.#transportSucceeded("ircc sendKey");
      const body = await r.text();
      if (r.status === 200 && (!body.trim() || body.includes("X_SendIRCCResponse"))) return { ok: true };
      let error: ApiError | string =
        /<faultstring>([^<]*)<\/faultstring>/.exec(body)?.[1] ??
        (body.includes("Fault") ? "unsupported" : body.slice(0, 200) || r.statusText);
      // IRCC replies are SOAP/XML; only if the TV answered with JSON do we
      // surface its structured error instead of the extracted text.
      try {
        const parsed = parseOkResult(JSON.parse(body) as unknown);
        if (parsed.error !== undefined) error = parsed.error;
      } catch {
        // Not JSON — keep the faultstring/raw-text error above.
      }
      return { ok: false, error, status: r.status };
    } catch (e) {
      this.#transportFailed("ircc sendKey", e);
      return { ok: false, error: String(e), status: 504 };
    }
  }

  /** Single source of the actRegister wire payload shared by both pairing steps. */
  #registerParams(nickname: string): unknown[] {
    return [
      { clientid: this.#credentials.snapshot.clientId, nickname, level: "private" },
      [{ name: "", value: "", function: "Register" }],
    ];
  }

  /** Normal-mode pairing step 1: ask the TV to show a 4-digit registration key. */
  async startRegistration(nickname: string): Promise<RpcResponse> {
    return this.rpc("accessControl", "actRegister", this.#registerParams(nickname));
  }

  /** Normal-mode pairing step 2: confirm the on-screen key via Basic auth (`":PIN"`). */
  async confirmRegistration(pin: string, nickname: string): Promise<RegistrationResult> {
    const basic = Buffer.from(`:${pin}`).toString("base64");
    let r: Response;
    try {
      r = await this.#fetch(`${this.#baseUrl}/sony/accessControl`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Basic ${basic}`,
          ...(this.#credentials.psk ? { "X-Auth-PSK": this.#credentials.psk } : {}),
        },
        body: JSON.stringify({
          method: "actRegister",
          id: 1,
          version: "1.0",
          params: this.#registerParams(nickname),
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(BraviaClient.PAIR_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, code: 504 };
    }
    // A non-JSON body still carries the real HTTP status — use it below.
    let parsed: RpcResponse;
    try {
      parsed = parseRpcResponse((await r.json()) as unknown);
    } catch {
      parsed = {};
    }
    if (parsed.result) {
      await this.#credentials.setRegistration(r.headers.get("authorization") ?? "", r.headers.get("set-cookie") ?? "");
      return { ok: true };
    }
    return { ok: false, code: parsed.error?.[0] ?? r.status };
  }

  /** Probe with only the candidate PSK; stale registration auth must not mask a bad key. */
  async probePsk(psk: string): Promise<RpcResponse> {
    return this.rpc("system", "getSystemInformation", [], psk, false);
  }
}
