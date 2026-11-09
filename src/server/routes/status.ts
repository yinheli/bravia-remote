/** GET /api/status, /api/codes, /api/info — read-only passthrough queries. */
import { type InfoPayload, parseRemoteCodes, type RpcResponse } from "../../shared/bravia";
import type { RouteHandler } from "../app";

/** GET /api/status — raw TV power status (used by the UI status poller). */
export const statusHandler: RouteHandler = async (ctx): Promise<Response> => {
  const status: RpcResponse = await ctx.tv.rpc("system", "getPowerStatus");
  return Response.json(status);
};

/** GET /api/codes — remote-control key names + IRCC codes from the TV. */
export const codesHandler: RouteHandler = async (ctx): Promise<Response> => {
  const json = await ctx.tv.rpc("system", "getRemoteControllerInfo");
  // The success body is a bare array, so failures use the shared `{ error }`
  // envelope to stay distinguishable from a legitimately empty code list.
  if (json.error) return Response.json({ error: json.error });
  // result[0] is the scheme info, result[1] holds the actual code list.
  const raw = json.result?.[1];
  if (!Array.isArray(raw)) return Response.json({ error: ["unknown", "unexpected getRemoteControllerInfo response"] });
  const list = parseRemoteCodes(raw).map(({ name, value }) => ({ name, code: value }));
  return Response.json(list);
};

/** GET /api/info — one parallel batch of everything the info panel shows. */
export const infoHandler: RouteHandler = async (ctx): Promise<Response> => {
  const [power, iface, inputs, volume, playing, time, powerSaving] = await Promise.all([
    ctx.tv.rpc("system", "getPowerStatus"),
    ctx.tv.rpc("system", "getInterfaceInformation"),
    ctx.tv.rpc("avContent", "getCurrentExternalInputsStatus"),
    ctx.tv.rpc("audio", "getVolumeInformation"),
    ctx.tv.rpc("avContent", "getPlayingContentInfo"),
    ctx.tv.rpc("system", "getCurrentTime"),
    ctx.tv.rpc("system", "getPowerSavingMode"),
  ]);
  const info: InfoPayload = { power, iface, inputs, volume, playing, time, powerSaving };
  return Response.json(info);
};
