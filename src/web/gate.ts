/**
 * AuthGate state machine (pure).
 *
 * `checking` and `authenticating` are effect states: the component runs the
 * request named by the state and returns exactly one result event. Keeping
 * these transitions out of React makes the gate testable and stops the
 * `busy`/`error`/`state` triple from disagreeing.
 */
import type { AuthState, LoginResult } from "./api";

export type GateError = "invalid" | "expired";

export type GateState =
  | { readonly kind: "checking" }
  | { readonly kind: "token"; readonly token: string; readonly error: GateError | null }
  | { readonly kind: "authenticating"; readonly token: string }
  | { readonly kind: "ready" }
  | { readonly kind: "unreachable" };

export const initialGateState: GateState = { kind: "checking" };

export type GateEvent =
  | { readonly type: "check" }
  | { readonly type: "checked"; readonly result: AuthState }
  | { readonly type: "token"; readonly value: string }
  | { readonly type: "submit" }
  | { readonly type: "login"; readonly result: LoginResult }
  | { readonly type: "expired" };

export function gateReducer(state: GateState, event: GateEvent): GateState {
  switch (event.type) {
    case "check":
      return state.kind === "checking" ? state : { kind: "checking" };
    case "checked":
      if (state.kind !== "checking") return state;
      if (event.result === "unreachable") return { kind: "unreachable" };
      if (event.result === "unauthorized") return { kind: "token", token: "", error: null };
      return { kind: "ready" };
    case "token":
      if (state.kind !== "token") return state;
      return { kind: "token", token: event.value, error: null };
    case "submit":
      if (state.kind !== "token" || !state.token.trim()) return state;
      return { kind: "authenticating", token: state.token.trim() };
    case "login":
      if (state.kind !== "authenticating") return state;
      if (event.result === "ok") return { kind: "ready" };
      if (event.result === "unreachable") return { kind: "unreachable" };
      return { kind: "token", token: state.token, error: "invalid" };
    case "expired":
      if (state.kind !== "ready") return state;
      return { kind: "token", token: "", error: "expired" };
  }
}
