/** GET /api/auth status · POST login with token · DELETE logout. */
import type { RouteHandler } from "../app";
import { type AuthConfig, clearSessionCookie, isTokenValid, sessionCookie, unauthorizedResponse } from "../auth";
import { readJsonBody } from "../http";
import { parseAuthBody } from "../requests";

const noStore = { "cache-control": "no-store" } as const;

/** The only handler allowed to see the resolved auth secret. */
export const createAuthHandler =
  (auth: AuthConfig): RouteHandler =>
  async (ctx, req) => {
    if (req.method === "POST") {
      if (auth.mode !== "token") return Response.json({ ok: false, error: ["bad"] }, { status: 400, headers: noStore });
      const { token } = parseAuthBody(await readJsonBody(req));
      if (!token || !isTokenValid(token, auth.token)) return unauthorizedResponse(auth);
      return new Response(JSON.stringify({ ok: true, mode: "token" }), {
        headers: { ...noStore, "content-type": "application/json", "set-cookie": sessionCookie(ctx.config, token) },
      });
    }

    if (req.method === "DELETE") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          ...noStore,
          "content-type": "application/json",
          "set-cookie": clearSessionCookie(ctx.config),
        },
      });
    }

    return Response.json({ ok: true, mode: auth.mode }, { headers: noStore });
  };
