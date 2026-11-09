import { describe, expect, test } from "bun:test";
import { type GateEvent, type GateState, gateReducer, initialGateState } from "./gate";

const reduce = (state: GateState, ...events: GateEvent[]): GateState => events.reduce(gateReducer, state);

const tokenState = reduce(initialGateState, { type: "checked", result: "unauthorized" });

describe("gateReducer", () => {
  test("maps the initial auth probe to the three terminal views", () => {
    expect(reduce(initialGateState, { type: "checked", result: "unreachable" })).toEqual({ kind: "unreachable" });
    expect(tokenState).toEqual({ kind: "token", token: "", error: null });
    expect(reduce(initialGateState, { type: "checked", result: { ok: true, mode: "token" } })).toEqual({
      kind: "ready",
    });
  });

  test("ignores a late probe result once the gate left checking", () => {
    const token = tokenState;
    expect(reduce(token, { type: "checked", result: { ok: true, mode: "none" } })).toBe(token);
  });

  test("editing the token clears a previous error", () => {
    const failed = reduce(
      tokenState,
      { type: "token", value: "abc" },
      { type: "submit" },
      { type: "login", result: "rejected" },
    );
    expect(failed).toEqual({ kind: "token", token: "abc", error: "invalid" });

    expect(reduce(failed, { type: "token", value: "abcd" })).toEqual({
      kind: "token",
      token: "abcd",
      error: null,
    });
  });

  test("submit ignores empty input and ignores duplicate submits", () => {
    expect(reduce(tokenState, { type: "submit" })).toBe(tokenState);
    expect(reduce(tokenState, { type: "token", value: "   " }, { type: "submit" }).kind).toBe("token");

    const authenticating = reduce(tokenState, { type: "token", value: "  secret  " }, { type: "submit" });
    expect(authenticating).toEqual({ kind: "authenticating", token: "secret" });
    expect(reduce(authenticating, { type: "submit" })).toBe(authenticating);
    expect(reduce(authenticating, { type: "token", value: "other" })).toBe(authenticating);
  });

  test("login success enters the app; rejection returns to the prompt with the token intact", () => {
    const authenticating = reduce(tokenState, { type: "token", value: "secret" }, { type: "submit" });
    expect(reduce(authenticating, { type: "login", result: "ok" })).toEqual({ kind: "ready" });
    expect(reduce(authenticating, { type: "login", result: "rejected" })).toEqual({
      kind: "token",
      token: "secret",
      error: "invalid",
    });
  });

  test("an unreachable login shows the retry view, not a wrong-token error", () => {
    const authenticating = reduce(tokenState, { type: "token", value: "secret" }, { type: "submit" });
    expect(reduce(authenticating, { type: "login", result: "unreachable" })).toEqual({ kind: "unreachable" });
  });

  test("a 401 while ready returns to the token prompt with an expiry message", () => {
    const ready = reduce(initialGateState, { type: "checked", result: { ok: true, mode: "token" } });
    expect(reduce(ready, { type: "expired" })).toEqual({ kind: "token", token: "", error: "expired" });
    // Only a ready session can expire; other views are already unauthenticated.
    expect(reduce(tokenState, { type: "expired" })).toBe(tokenState);
    expect(reduce(initialGateState, { type: "expired" })).toBe(initialGateState);
  });

  test("retry after an unreachable server returns to checking", () => {
    const unreachable = reduce(initialGateState, { type: "checked", result: "unreachable" });
    const checking = reduce(unreachable, { type: "check" });
    expect(checking).toEqual({ kind: "checking" });
    expect(reduce(checking, { type: "checked", result: "unauthorized" }).kind).toBe("token");
  });
});
