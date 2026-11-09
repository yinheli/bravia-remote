/**
 * /api/pair — Normal-mode (PIN) and PSK pairing, plus the GET status probe.
 *
 * Normal mode flow: POST {} asks the TV to pop up a 4-digit registration key
 * (responds `needKey`), then POST { key } confirms it via Basic auth.
 * PSK flow: POST { psk } validates the key against the TV before persisting.
 */
import { isPairChallengeCode } from "../../shared/api";
import type { RouteHandler } from "../app";
import { readJsonBody } from "../http";
import { parsePairBody } from "../requests";

export const pairHandler: RouteHandler = async (ctx, req) => {
  if (req.method !== "POST")
    return Response.json({
      nickname: ctx.credentials.nickname,
      clientid: ctx.credentials.snapshot.clientId,
      paired: ctx.credentials.paired,
    });
  const { nickname, key, psk } = parsePairBody(await readJsonBody(req));

  if (nickname) await ctx.credentials.setNickname(nickname);

  if (psk) {
    // PSK mode: only persist after the key has been verified against the TV.
    const probe = await ctx.tv.probePsk(psk);
    if (probe.result !== undefined) {
      await ctx.credentials.setPsk(psk);
      return Response.json({ ok: true, paired: true, mode: "psk" });
    }
    const err: readonly unknown[] | undefined = probe.error ?? ["unknown"];
    const mapped = err[0] === 403 || err[0] === 401 ? ["auth"] : err;
    return Response.json({ ok: false, error: mapped });
  }

  if (key) {
    const result = await ctx.tv.confirmRegistration(key, ctx.credentials.nickname);
    if (result.ok) return Response.json({ ok: true, paired: true });
    const code = result.code ?? 504;
    // Only a TV auth code means the key was challenged. A transport failure
    // (504) or TV server error must not re-prompt for a PIN that may be valid.
    if (isPairChallengeCode(code)) return Response.json({ ok: false, needKey: true, code });
    return Response.json({
      ok: false,
      error: [code, code === 504 ? "TV unreachable" : "pairing failed"],
    });
  }

  // Bootstrap request: the TV pops up the 4-digit registration key on screen.
  // A TV with PSK auth may accept the registration silently instead.
  const json = await ctx.tv.startRegistration(ctx.credentials.nickname);
  if (json.result !== undefined) {
    return Response.json({ ok: true, paired: true });
  }
  const err = json.error;
  if (err && (err[0] === 40003 || err[0] === 16 || err[0] === 401))
    return Response.json({ ok: false, needKey: true, code: err[0] });
  return Response.json({ ok: false, error: err ?? ["unknown"] });
};
