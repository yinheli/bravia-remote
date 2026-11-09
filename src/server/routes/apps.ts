/**
 * /api/app — launch an app (or go back to the previous one) and record it in
 * the MRU history; /api/config — custom app buttons for the web UI.
 */

import type { RouteHandler } from "../app";
import { readJsonBody } from "../http";
import { parseAppBody } from "../requests";

/** POST /api/app { uri } or { back: true } */
export const launchAppHandler: RouteHandler = async (ctx, req) => {
  const body = parseAppBody(await readJsonBody(req));

  // "Back" jumps to the previously launched app, alt-tab style.
  if (body.back) {
    const target = ctx.history.peekBack();
    if (!target) return Response.json({ ok: false, error: ["none"] });
    const json = await ctx.tv.rpc("appControl", "setActiveApp", [{ uri: target }]);
    if (json.result === undefined) return Response.json({ ok: false, error: json.error ?? ["unknown"] });
    // Reorder only after the TV accepted, so a failed back never poisons the MRU.
    ctx.history.confirmBack(target);
    return Response.json({ ok: true, app: target });
  }

  const { uri } = body;
  const json = await ctx.tv.rpc("appControl", "setActiveApp", [{ uri }]);
  if (json.result === undefined) return Response.json({ ok: false, error: json.error ?? ["unknown"] });
  ctx.history.push(uri);
  return Response.json({ ok: true });
};

/** GET /api/config — apps configured via BRAVIA_APPS, rendered as buttons. */
export const configHandler: RouteHandler = (ctx) => Response.json({ apps: ctx.config.customApps });
