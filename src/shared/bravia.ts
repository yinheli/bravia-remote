/**
 * Types and parsers for the Sony Bravia "Simple IP Control" REST API.
 * Responses are JSON-RPC-ish: `{ result: [...] }` or `{ error: [code, message] }`.
 */
import { isRecord } from "./parse";

export type RpcError = readonly [code: number, message: string];

export type RpcResponse = {
  result?: unknown[];
  error?: RpcError;
};

export type ApiError = readonly [code: number | string, message: string];

export const parseApiError = (v: unknown): ApiError | undefined => {
  if (!Array.isArray(v)) return undefined;
  const code: unknown = v[0];
  if (typeof code !== "number" && typeof code !== "string") return undefined;
  const message: unknown = v[1];
  return [code, typeof message === "string" ? message : ""];
};

const parseRpcError = (v: unknown): RpcError | undefined => {
  const error = parseApiError(v);
  return error && typeof error[0] === "number" ? [error[0], error[1]] : undefined;
};

export const parseRpcResponse = (v: unknown): RpcResponse => {
  if (!isRecord(v)) return {};
  return {
    result: Array.isArray(v.result) ? v.result : undefined,
    error: parseRpcError(v.error),
  };
};

const str = (o: Record<string, unknown>, key: string): string | undefined => {
  const value = o[key];
  return typeof value === "string" ? value : undefined;
};

const num = (o: Record<string, unknown>, key: string): number | undefined => {
  const value = o[key];
  return typeof value === "number" ? value : undefined;
};

const bool = (o: Record<string, unknown>, key: string): boolean | undefined => {
  const value = o[key];
  return typeof value === "boolean" ? value : undefined;
};

export type PowerStatus = { status: string };

export const parsePowerStatus = (v: unknown): PowerStatus | undefined => {
  if (!isRecord(v)) return undefined;
  const status = str(v, "status");
  return status ? { status } : undefined;
};

export type RemoteCode = { name: string; value: string };

export const parseRemoteCodes = (v: unknown): RemoteCode[] => {
  if (!Array.isArray(v)) return [];
  return v.flatMap((item): RemoteCode[] => {
    if (!isRecord(item)) return [];
    const name = str(item, "name");
    const value = str(item, "value");
    return name !== undefined && value !== undefined ? [{ name, value }] : [];
  });
};

export type VolumeInfo = { target: string; volume: number; mute: boolean };

const parseVolume = (v: unknown): VolumeInfo | undefined => {
  if (!isRecord(v)) return undefined;
  const target = str(v, "target");
  const volume = num(v, "volume");
  const mute = bool(v, "mute");
  return target !== undefined && volume !== undefined && mute !== undefined ? { target, volume, mute } : undefined;
};

export const parseVolumeInfos = (v: unknown): VolumeInfo[] => {
  if (!Array.isArray(v)) return [];
  return v.flatMap((item): VolumeInfo[] => {
    const parsed = parseVolume(item);
    return parsed ? [parsed] : [];
  });
};

export type InputInfo = {
  uri: string;
  /** Default input name localized by the TV. */
  title: string;
  /** User-set name from the TV; empty when the default is in use. */
  label?: string;
  connection: boolean;
};

const parseInput = (v: unknown): InputInfo | undefined => {
  if (!isRecord(v)) return undefined;
  const uri = str(v, "uri");
  const title = str(v, "title");
  const connection = bool(v, "connection");
  if (uri === undefined || title === undefined || connection === undefined) return undefined;
  const label = str(v, "label");
  return { uri, title, connection, ...(label === undefined ? {} : { label }) };
};

export const parseInputInfos = (v: unknown): InputInfo[] => {
  if (!Array.isArray(v)) return [];
  return v.flatMap((item): InputInfo[] => {
    const parsed = parseInput(item);
    return parsed ? [parsed] : [];
  });
};

export type InterfaceInfo = {
  modelName?: string;
  productName?: string;
  interfaceVersion?: string;
};

export const parseInterfaceInfo = (v: unknown): InterfaceInfo | undefined => {
  if (!isRecord(v)) return undefined;
  return {
    modelName: str(v, "modelName"),
    productName: str(v, "productName"),
    interfaceVersion: str(v, "interfaceVersion"),
  };
};

export type PlayingContent = { title?: string; source?: string };

export const parsePlayingContent = (v: unknown): PlayingContent | undefined => {
  if (!isRecord(v)) return undefined;
  const title = str(v, "title");
  const source = str(v, "source");
  return title || source ? { title, source } : undefined;
};

export const parseTime = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export type PowerSaving = { mode: string };

export const parsePowerSaving = (v: unknown): PowerSaving | undefined => {
  if (!isRecord(v)) return undefined;
  const mode = str(v, "mode");
  return mode === undefined ? undefined : { mode };
};

export type InfoPayload = {
  power: RpcResponse;
  iface: RpcResponse;
  inputs: RpcResponse;
  volume: RpcResponse;
  playing: RpcResponse;
  time: RpcResponse;
  powerSaving: RpcResponse;
};

/** Parse the aggregated `/api/info` response into typed RPC envelopes. */
export const parseInfoPayload = (v: unknown): InfoPayload | undefined => {
  if (!isRecord(v)) return undefined;
  return {
    power: parseRpcResponse(v.power),
    iface: parseRpcResponse(v.iface),
    inputs: parseRpcResponse(v.inputs),
    volume: parseRpcResponse(v.volume),
    playing: parseRpcResponse(v.playing),
    time: parseRpcResponse(v.time),
    powerSaving: parseRpcResponse(v.powerSaving),
  };
};
