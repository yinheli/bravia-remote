/**
 * PairDialog state machine (pure).
 *
 * The component dispatches user events and runs the single async request held
 * in `state.request`; every result comes back as an `outcome` event. Keeping
 * transitions out of React makes the PIN and PSK flows independently testable
 * and rules out illegal combinations such as two requests in flight, a success
 * while busy, or a mode switch mid-request.
 */
import type { PairOutcome } from "./api";

export type PairMode = "pin" | "psk";

/** `awaitingPin` is the interval after the TV displayed its registration key. */
export type PairPhase = "idle" | "awaitingPin" | "succeeded" | "failed";

export type PairOp = "start" | "submitPin" | "verifyPsk";

export type PairRequest = {
  readonly op: PairOp;
  readonly nickname: string;
  readonly pin: string;
  readonly psk: string;
};

export type PairState = {
  readonly mode: PairMode;
  readonly phase: PairPhase;
  /** Non-null exactly while a pairing request is in flight. */
  readonly request: PairRequest | null;
  readonly message: string;
  readonly pin: string;
  readonly nickname: string;
  readonly psk: string;
  readonly paired: boolean;
  readonly repairing: boolean;
};

export const initialPairState = (paired: boolean): PairState => ({
  mode: "pin",
  phase: "idle",
  request: null,
  message: "",
  pin: "",
  nickname: "",
  psk: "",
  paired,
  repairing: false,
});

export type PairEvent =
  | { readonly type: "status"; readonly nickname: string; readonly paired: boolean }
  | { readonly type: "mode"; readonly mode: PairMode }
  | { readonly type: "nickname"; readonly value: string }
  | { readonly type: "pin"; readonly value: string }
  | { readonly type: "psk"; readonly value: string }
  | { readonly type: "start" }
  | { readonly type: "submitPin" }
  | { readonly type: "verifyPsk" }
  | { readonly type: "outcome"; readonly outcome: PairOutcome }
  | { readonly type: "repair" };

const requestFor = (state: PairState, op: PairOp): PairRequest => ({
  op,
  nickname: state.nickname.trim(),
  pin: state.pin,
  psk: state.psk.trim(),
});

export function pairReducer(state: PairState, event: PairEvent): PairState {
  switch (event.type) {
    case "status":
      // Server truth fills a blank nickname; it must not clobber typing, an
      // in-flight request, or a success screen.
      if (state.request || state.phase === "succeeded") return state;
      return {
        ...state,
        nickname: state.nickname || event.nickname,
        paired: state.repairing ? state.paired : event.paired,
      };
    case "mode":
      if (state.request || state.phase === "succeeded" || state.mode === event.mode) return state;
      // A stage belongs to one mode: switching tabs resets stale PIN prompts
      // and failure messages instead of carrying them into the other flow.
      return { ...state, mode: event.mode, phase: "idle", message: "" };
    case "nickname":
      if (state.request || state.phase === "succeeded") return state;
      return { ...state, nickname: event.value };
    case "pin":
      if (state.request || state.phase === "succeeded") return state;
      return { ...state, pin: event.value.replace(/\D/g, "").slice(0, 4) };
    case "psk":
      if (state.request || state.phase === "succeeded") return state;
      return { ...state, psk: event.value };
    case "start":
      if (state.request || state.phase === "succeeded") return state;
      return { ...state, request: requestFor(state, "start"), message: "" };
    case "submitPin":
      if (state.request || state.phase !== "awaitingPin" || state.pin.length !== 4) return state;
      return { ...state, request: requestFor(state, "submitPin"), message: "" };
    case "verifyPsk":
      if (state.request || state.mode !== "psk" || !state.psk.trim()) return state;
      return { ...state, request: requestFor(state, "verifyPsk"), message: "" };
    case "outcome": {
      if (!state.request) return state;
      const { stage, message } = event.outcome;
      if (stage === "ok")
        return { ...state, request: null, phase: "succeeded", message, paired: true, repairing: false };
      // A PSK probe can never legitimately ask for a PIN; treat that as a
      // protocol failure instead of showing a PIN prompt in the PSK tab.
      if (stage === "needKey" && state.request.op !== "verifyPsk")
        return { ...state, request: null, phase: "awaitingPin", message };
      return { ...state, request: null, phase: "failed", message };
    }
    case "repair":
      if (state.request) return state;
      return { ...state, paired: false, repairing: true, phase: "idle", message: "", pin: "", psk: "" };
  }
}
