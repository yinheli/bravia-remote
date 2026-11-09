/** Blocks the remote until the server accepts a token (token auth mode). */
import { useEffect, useReducer } from "react";
import { App } from "./AppShell";
import { fetchAuthStatus, loginWithToken, onUnauthorized } from "./api";
import { KBTN, OVERLAY, PAIRNAME, SHEET } from "./classes";
import { gateReducer, initialGateState } from "./gate";
import { t } from "./i18n";

export function AuthGate() {
  const [state, dispatch] = useReducer(gateReducer, initialGateState);

  /* A 401 from a live session returns to the prompt; login 401s stay local. */
  useEffect(() => onUnauthorized(() => dispatch({ type: "expired" })), []);

  /* Probe once on mount and again whenever the user retries. */
  useEffect(() => {
    if (state.kind !== "checking") return;
    let live = true;
    void fetchAuthStatus()
      .then((result) => {
        if (live) dispatch({ type: "checked", result });
      })
      .catch(() => {
        if (live) dispatch({ type: "checked", result: "unreachable" });
      });
    return () => {
      live = false;
    };
  }, [state.kind]);

  /* Exchange the token for a session cookie; the result is the only way out. */
  useEffect(() => {
    if (state.kind !== "authenticating") return;
    let live = true;
    void loginWithToken(state.token)
      .then((result) => {
        if (live) dispatch({ type: "login", result });
      })
      .catch(() => {
        if (live) dispatch({ type: "login", result: "unreachable" });
      });
    return () => {
      live = false;
    };
  }, [state]);

  if (state.kind === "ready") return <App />;

  return (
    <div className={OVERLAY}>
      <div className={SHEET}>
        {state.kind === "token" || state.kind === "authenticating" ? (
          <>
            <h2 className="mb-2.5 text-[15px] font-bold">{t("authTitle")}</h2>
            <p className="my-[13px] text-[13px] leading-[1.6] text-faint">{t("authHint")}</p>
            <input
              className={PAIRNAME}
              type="password"
              aria-label={t("authPlaceholder")}
              autoComplete="off"
              autoFocus
              disabled={state.kind === "authenticating"}
              placeholder={t("authPlaceholder")}
              value={state.token}
              onChange={(e) => dispatch({ type: "token", value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") dispatch({ type: "submit" });
              }}
            />
            {state.kind === "token" && state.error && (
              <p className="my-[13px] text-[13px] text-danger">
                {t(state.error === "expired" ? "authExpired" : "authInvalid")}
              </p>
            )}
            <button
              type="button"
              className={`${KBTN} w-full`}
              disabled={state.kind === "authenticating" || !state.token.trim()}
              onClick={() => dispatch({ type: "submit" })}
            >
              {state.kind === "authenticating" ? t("loading") : t("authUnlock")}
            </button>
          </>
        ) : state.kind === "unreachable" ? (
          <>
            <h2 className="mb-2.5 text-[15px] font-bold">{t("errConnectServer")}</h2>
            <button type="button" className={`${KBTN} w-full`} onClick={() => dispatch({ type: "check" })}>
              {t("pairRetry")}
            </button>
          </>
        ) : (
          <h2 className="mb-2.5 text-[15px] font-bold">{t("loading")}</h2>
        )}
      </div>
    </div>
  );
}
