/** POST /api/key { code } — send one remote-control key over IRCC. */
import type { RouteHandler } from "../app";
import { readJsonBody } from "../http";
import { parseKeyBody } from "../requests";

export const keyHandler: RouteHandler = async (ctx, req) => {
  const { code } = parseKeyBody(await readJsonBody(req));
  const result = await ctx.tv.sendKey(code);
  return result.ok
    ? Response.json({ ok: true })
    : Response.json({ ok: false, error: result.error }, { status: result.status });
};
