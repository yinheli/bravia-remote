import { describe, expect, test } from "bun:test";
import { initialPairState, type PairEvent, type PairState, pairReducer } from "./pairing";

const reduce = (state: PairState, ...events: PairEvent[]): PairState => events.reduce(pairReducer, state);

const outcome = (stage: "ok" | "needKey" | "fail", message: string = stage): PairEvent => ({
  type: "outcome",
  outcome: { stage, message },
});

/** Drive the machine to the PIN-awaiting state via a bootstrap request. */
const awaitingPin = (state = initialPairState(false)): PairState =>
  reduce(state, { type: "start" }, outcome("needKey", "enter the key"));

describe("pairReducer", () => {
  test("starts idle with the parent's paired flag", () => {
    expect(initialPairState(false)).toMatchObject({ mode: "pin", phase: "idle", paired: false, request: null });
    expect(initialPairState(true).paired).toBe(true);
  });

  test("status fills a blank nickname and reports server pairing", () => {
    const state = reduce(initialPairState(false), { type: "status", nickname: "living-room", paired: true });
    expect(state.nickname).toBe("living-room");
    expect(state.paired).toBe(true);
  });

  test("status does not clobber typing or an in-flight request", () => {
    const typed = reduce(
      initialPairState(false),
      { type: "nickname", value: "my-name" },
      { type: "status", nickname: "host", paired: true },
    );
    expect(typed.nickname).toBe("my-name");
    expect(typed.paired).toBe(true);

    const started = reduce(
      initialPairState(false),
      { type: "start" },
      { type: "status", nickname: "host", paired: true },
    );
    expect(started.request).not.toBeNull();
    expect(started.paired).toBe(false);
  });

  test("start captures the trimmed nickname and ignores duplicate starts", () => {
    const once = reduce(initialPairState(false), { type: "nickname", value: "  living  " }, { type: "start" });
    expect(once.request).toEqual({ op: "start", nickname: "living", pin: "", psk: "" });

    const twice = reduce(once, { type: "start" });
    expect(twice).toBe(once);
  });

  test("pin input is digits-only and capped at four", () => {
    const state = reduce(initialPairState(false), { type: "pin", value: "a1b2c3d4e5" });
    expect(state.pin).toBe("1234");
  });

  test("submitPin only runs from awaitingPin with four digits", () => {
    expect(reduce(initialPairState(false), { type: "pin", value: "1234" }, { type: "submitPin" }).request).toBeNull();

    const three = reduce(awaitingPin(), { type: "pin", value: "123" }, { type: "submitPin" });
    expect(three.request).toBeNull();

    const four = reduce(awaitingPin(), { type: "pin", value: "1234" }, { type: "submitPin" });
    expect(four.request).toEqual({ op: "submitPin", nickname: "", pin: "1234", psk: "" });
  });

  test("needKey moves to awaitingPin and retry starts a fresh registration", () => {
    const state = awaitingPin();
    expect(state.phase).toBe("awaitingPin");
    expect(state.message).toBe("enter the key");
    expect(state.request).toBeNull();

    const retry = reduce(state, { type: "start" });
    expect(retry.phase).toBe("awaitingPin");
    expect(retry.request).toEqual({ op: "start", nickname: "", pin: "", psk: "" });
  });

  test("success settles paired and ignores later edits", () => {
    const state = reduce(awaitingPin(), { type: "pin", value: "1234" }, { type: "submitPin" }, outcome("ok", "paired"));
    expect(state).toMatchObject({ phase: "succeeded", paired: true, request: null, message: "paired" });

    expect(reduce(state, { type: "mode", mode: "psk" })).toBe(state);
    expect(reduce(state, { type: "pin", value: "9999" })).toBe(state);
    expect(reduce(state, { type: "status", nickname: "host", paired: false })).toBe(state);
  });

  test("failure is recoverable", () => {
    const failed = reduce(initialPairState(false), { type: "start" }, outcome("fail", "standby"));
    expect(failed).toMatchObject({ phase: "failed", message: "standby", request: null });

    const retry = reduce(failed, { type: "start" });
    expect(retry.request).toEqual({ op: "start", nickname: "", pin: "", psk: "" });
    expect(retry.message).toBe("");
  });

  test("mode switch resets stale phase/message but is blocked mid-request", () => {
    const busy = reduce(initialPairState(false), { type: "start" }, { type: "mode", mode: "psk" });
    expect(busy.mode).toBe("pin");

    const failed = reduce(initialPairState(false), { type: "start" }, outcome("fail", "standby"));
    const switched = reduce(failed, { type: "mode", mode: "psk" });
    expect(switched).toMatchObject({ mode: "psk", phase: "idle", message: "" });
  });

  test("verifyPsk requires psk mode and a non-empty key", () => {
    expect(reduce(initialPairState(false), { type: "psk", value: "key" }, { type: "verifyPsk" }).request).toBeNull();

    const ready = reduce(
      initialPairState(false),
      { type: "mode", mode: "psk" },
      { type: "psk", value: "  key  " },
      { type: "verifyPsk" },
    );
    expect(ready.request).toEqual({ op: "verifyPsk", nickname: "", pin: "", psk: "key" });

    expect(
      reduce(
        initialPairState(false),
        { type: "mode", mode: "psk" },
        { type: "psk", value: "   " },
        { type: "verifyPsk" },
      ).request,
    ).toBeNull();
  });

  test("a PSK needKey outcome is a failure, never a PIN prompt", () => {
    const state = reduce(
      initialPairState(false),
      { type: "mode", mode: "psk" },
      { type: "psk", value: "key" },
      { type: "verifyPsk" },
      outcome("needKey", "unexpected"),
    );
    expect(state.phase).toBe("failed");
  });

  test("repair clears secrets and returns to idle", () => {
    const state = reduce(initialPairState(true), { type: "pin", value: "1234" }, { type: "repair" });
    expect(state).toMatchObject({ paired: false, repairing: true, phase: "idle", pin: "", psk: "" });
    expect(reduce(state, { type: "status", nickname: "host", paired: true }).paired).toBe(false);
  });

  test("outcome without an in-flight request is ignored", () => {
    const idle = initialPairState(false);
    expect(reduce(idle, outcome("ok"))).toBe(idle);
  });
});
