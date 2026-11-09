/** Pairing overlay: Normal-mode PIN flow and PSK validation. */
import { useEffect, useId, useReducer, useRef } from "react";
import { fetchPairStatus, startPairing, submitPin, verifyPsk } from "../api";
import { HBTN, KBTN, OVERLAY, PAIRINPUT, PAIRNAME, SHEET } from "../classes";
import { useDialogFocus } from "../focus";
import { t } from "../i18n";
import { initialPairState, pairReducer } from "../pairing";

type PairDialogProps = {
  paired: boolean;
  setPaired: (paired: boolean) => void;
  onClose: () => void;
};

export function PairDialog({ paired, setPaired, onClose }: PairDialogProps) {
  const [state, dispatch] = useReducer(pairReducer, paired, initialPairState);
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  useDialogFocus(sheetRef);

  /* Keep the shell's paired badge in sync with machine transitions. */
  useEffect(() => {
    setPaired(state.paired);
  }, [setPaired, state.paired]);

  /* Pairing status: fetched once when the dialog opens. */
  useEffect(() => {
    let stop = false;
    fetchPairStatus()
      .then((s) => {
        if (stop || !s) return;
        dispatch({ type: "status", nickname: s.nickname, paired: s.paired });
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);

  /* Run the single request named by the machine; its outcome is the only
     event that can leave the in-flight state. */
  useEffect(() => {
    const request = state.request;
    if (!request) return;
    let live = true;
    const call =
      request.op === "start"
        ? startPairing(request.nickname || undefined)
        : request.op === "submitPin"
          ? submitPin(request.pin)
          : verifyPsk(request.psk);
    void call
      .then((outcome) => {
        if (live) dispatch({ type: "outcome", outcome });
      })
      .catch(() => {
        if (live) dispatch({ type: "outcome", outcome: { stage: "fail", message: t("errConnectServer") } });
      });
    return () => {
      live = false;
    };
  }, [state.request]);

  const busy = state.request !== null;
  const pinReady = state.pin.length === 4;
  const pskReady = state.psk.trim().length > 0;

  const message = state.message && (
    <p className={`my-[13px] text-[13px] ${state.phase === "failed" ? "text-danger" : "text-faint"}`}>
      {state.message}
    </p>
  );

  return (
    <div
      className={OVERLAY}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div ref={sheetRef} className={SHEET} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="mb-2.5 text-[15px] font-bold">
          {t("pairTitle")}
        </h2>
        {state.phase === "succeeded" ? (
          <>
            <p className="my-3.5 text-sm text-success">{state.message}</p>
            <button type="button" className={`${KBTN} w-full`} onClick={onClose}>
              {t("btnClose")}
            </button>
          </>
        ) : state.paired && !state.repairing && state.phase === "idle" ? (
          <>
            <p className="my-3.5 text-sm text-success">{t("pairPairedMsg")}</p>
            <div className="flex gap-2">
              <button type="button" className={`${KBTN} flex-1`} onClick={() => dispatch({ type: "repair" })}>
                {t("pairRePair")}
              </button>
              <button type="button" className={`${KBTN} flex-1`} onClick={onClose}>
                {t("btnClose")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-2.5 flex gap-2">
              <button
                type="button"
                className={HBTN}
                disabled={busy}
                onClick={() => dispatch({ type: "mode", mode: "pin" })}
              >
                {t("pairPinTab")}
              </button>
              <button
                type="button"
                className={HBTN}
                disabled={busy}
                onClick={() => dispatch({ type: "mode", mode: "psk" })}
              >
                {t("pairPskTab")}
              </button>
            </div>
            {state.mode === "pin" ? (
              <>
                <p className="my-[13px] whitespace-pre-line text-[13px] leading-[1.6] text-muted">
                  {t("pairPinSteps")}
                </p>
                {state.phase === "idle" && (
                  <input
                    className={PAIRNAME}
                    aria-label={t("pairNamePlaceholder")}
                    autoComplete="off"
                    disabled={busy}
                    placeholder={t("pairNamePlaceholder")}
                    value={state.nickname}
                    onChange={(e) => dispatch({ type: "nickname", value: e.target.value })}
                  />
                )}
                {state.phase === "awaitingPin" && (
                  <input
                    className={PAIRINPUT}
                    aria-label={t("pairPinPlaceholder")}
                    autoComplete="off"
                    autoFocus
                    disabled={busy}
                    inputMode="numeric"
                    maxLength={4}
                    placeholder={t("pairPinPlaceholder")}
                    value={state.pin}
                    onChange={(e) => dispatch({ type: "pin", value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && pinReady && !busy) dispatch({ type: "submitPin" });
                    }}
                  />
                )}
                {message}
                <div className="flex flex-wrap gap-2">
                  {state.phase === "awaitingPin" && (
                    <>
                      <button
                        type="button"
                        className={`${KBTN} flex-1`}
                        disabled={busy || !pinReady}
                        onClick={() => dispatch({ type: "submitPin" })}
                      >
                        {t("pairSubmitPin")}
                      </button>
                      <button
                        type="button"
                        className={`${KBTN} flex-1`}
                        disabled={busy}
                        onClick={() => dispatch({ type: "start" })}
                      >
                        {t("pairRetry")}
                      </button>
                    </>
                  )}
                  {(state.phase === "idle" || state.phase === "failed") && (
                    <button
                      type="button"
                      className={`${KBTN} flex-1`}
                      disabled={busy}
                      onClick={() => dispatch({ type: "start" })}
                    >
                      {t("pairStart")}
                    </button>
                  )}
                  <button type="button" className={`${KBTN} flex-1`} disabled={busy} onClick={onClose}>
                    {t("btnClose")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="my-[13px] whitespace-pre-line text-[13px] leading-[1.6] text-muted">{t("pairPskHint")}</p>
                <input
                  className={PAIRNAME}
                  type="password"
                  aria-label={t("pairPskPlaceholder")}
                  autoComplete="off"
                  disabled={busy}
                  placeholder={t("pairPskPlaceholder")}
                  value={state.psk}
                  onChange={(e) => dispatch({ type: "psk", value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && pskReady && !busy) dispatch({ type: "verifyPsk" });
                  }}
                />
                {message}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`${KBTN} flex-1`}
                    disabled={busy || !pskReady}
                    onClick={() => dispatch({ type: "verifyPsk" })}
                  >
                    {t("pairPskSave")}
                  </button>
                  <button type="button" className={`${KBTN} flex-1`} disabled={busy} onClick={onClose}>
                    {t("btnClose")}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
