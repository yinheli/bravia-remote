/** Typed wire-response parsers shared by the server and web UI. */
import type { CustomApp } from "./apps";
import { type ApiError, parseApiError } from "./bravia";
import { isRecord } from "./parse";

export type AuthMode = "token" | "basic" | "none";

export type PairStatus = { nickname: string; paired: boolean };

export const parsePairStatus = (v: unknown): PairStatus | undefined => {
  if (!isRecord(v)) return undefined;
  const nickname = typeof v.nickname === "string" ? v.nickname : undefined;
  const paired = typeof v.paired === "boolean" ? v.paired : undefined;
  return nickname !== undefined || paired !== undefined
    ? { nickname: nickname ?? "", paired: paired ?? false }
    : undefined;
};

export type PairActionResult = {
  paired?: boolean;
  needKey?: boolean;
  code?: number;
  error?: ApiError;
};

export const parsePairActionResult = (v: unknown): PairActionResult => {
  if (!isRecord(v)) return {};
  return {
    paired: typeof v.paired === "boolean" ? v.paired : undefined,
    needKey: v.needKey === true,
    code: typeof v.code === "number" ? v.code : undefined,
    error: parseApiError(v.error),
  };
};

/** TV auth codes that mean the on-screen registration key was challenged. */
export const isPairChallengeCode = (code: number | undefined): boolean =>
  code === 401 || code === 403 || code === 40003 || code === 16;

export type OkResult = { ok: boolean; error?: ApiError | string };

const parseError = (v: unknown): ApiError | string | undefined => {
  const api = parseApiError(v);
  if (api) return api;
  return typeof v === "string" ? v : undefined;
};

export const parseOkResult = (v: unknown): OkResult => {
  if (!isRecord(v)) return { ok: false };
  return { ok: v.ok === true, error: parseError(v.error) };
};

const isCustomApp = (v: unknown): v is CustomApp => {
  if (!isRecord(v)) return false;
  return typeof v.name === "string" && typeof v.uri === "string";
};

/** `{ apps }` config response; undefined when the body is not one (request failed). */
export const parseCustomApps = (v: unknown): CustomApp[] | undefined => {
  if (!isRecord(v) || !Array.isArray(v.apps)) return undefined;
  return v.apps.flatMap((item): CustomApp[] => (isCustomApp(item) ? [{ name: item.name, uri: item.uri }] : []));
};

export type CodeInfo = { name: string; code: string };

export const parseCodeInfos = (v: unknown): CodeInfo[] => {
  if (!Array.isArray(v)) return [];
  return v.flatMap((item): CodeInfo[] => {
    if (!isRecord(item)) return [];
    const name = typeof item.name === "string" ? item.name : undefined;
    const code = typeof item.code === "string" ? item.code : undefined;
    return name && code ? [{ name, code }] : [];
  });
};

export type ScreenError = { code?: string; bytes?: number };

export const parseScreenError = (v: unknown): ScreenError => {
  if (!isRecord(v)) return {};
  // The capture route uses a string code; the central guards use the shared
  // `ApiError` array. Normalize both to the endpoint's string-code shape.
  const api = parseApiError(v.error);
  return {
    code: typeof v.error === "string" ? v.error : api ? String(api[0]) : undefined,
    bytes: typeof v.bytes === "number" ? v.bytes : undefined,
  };
};

export type AuthResult = { ok: true; mode: AuthMode };

export const parseAuthResult = (v: unknown): AuthResult | undefined => {
  if (!isRecord(v)) return undefined;
  const mode = v.mode;
  return v.ok === true && (mode === "token" || mode === "basic" || mode === "none") ? { ok: true, mode } : undefined;
};
