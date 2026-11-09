/** Typed request-body parsers; call these after `readJsonBody`. */
import { isAppUri } from "../shared/apps";
import { isRecord } from "../shared/parse";
import { BadRequestError } from "./http";

const object = (v: unknown): Record<string, unknown> => {
  if (!isRecord(v)) throw new BadRequestError("body must be a JSON object");
  return v;
};

const string = (o: Record<string, unknown>, key: string): string | undefined => {
  const value = o[key];
  return typeof value === "string" ? value.trim() || undefined : undefined;
};

export type PairBody = { nickname?: string; key?: string; psk?: string };

export const parsePairBody = (v: unknown): PairBody => {
  const body = object(v);
  return { nickname: string(body, "nickname"), key: string(body, "key"), psk: string(body, "psk") };
};

/** Base64 IRCC payload; other text would corrupt the SOAP envelope. */
const IRCC_CODE_PATTERN = /^[A-Za-z0-9+/]{4,80}={0,2}$/;

export const parseKeyBody = (v: unknown): { code: string } => {
  const code = string(object(v), "code");
  if (!code || !IRCC_CODE_PATTERN.test(code)) throw new BadRequestError("code must be a base64 IRCC payload");
  return { code };
};

export type AppBody = { back: true } | { back: false; uri: string };

export const parseAppBody = (v: unknown): AppBody => {
  const body = object(v);
  if (body.back === true) return { back: true };
  const uri = string(body, "uri");
  if (!uri || !isAppUri(uri)) throw new BadRequestError("uri must match the app URI pattern");
  return { back: false, uri };
};

export const parseAuthBody = (v: unknown): { token?: string } => ({ token: string(object(v), "token") });
