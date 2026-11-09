/** Application shell: header, status poll, keyboard bindings, overlays. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type AppActionBody,
  backApp,
  fetchCodes,
  fetchPairStatus,
  fetchPowerStatus,
  fetchWebConfig,
  launchApp,
  type SendResult,
  sendKeyCode,
} from "./api";
import { HBTN, LANG_SELECT } from "./classes";
import { HelpDialog } from "./components/HelpDialog";
import { InfoPanel } from "./components/InfoPanel";
import { PairDialog } from "./components/PairDialog";
import { Remote } from "./components/Remote";
import { applyDocumentLocale, getLangPref, type LangPref, setLangPref, t } from "./i18n";
import { type CustomApp, resolveKeyAction, STANDARD_IRCC_CODES } from "./keys";
import { applyPollPaired, confirmPaired, initialPairedBadge } from "./paired";
import { initialPollState, type PollFetchers, runPoll, startPollLoop } from "./poll";

type Status = "active" | "standby" | null;

const POLL_FETCHERS: PollFetchers = {
  power: fetchPowerStatus,
  pair: fetchPairStatus,
  config: fetchWebConfig,
  codes: fetchCodes,
};

export function App() {
  const [status, setStatus] = useState<Status>(null);
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [pairedBadge, setPairedBadge] = useState(() => initialPairedBadge(false));
  const paired = pairedBadge.paired;
  const pairedBadgeRef = useRef(pairedBadge);
  const [infoOpen, setInfoOpen] = useState(false);
  const [shotZoom, setShotZoom] = useState(false);
  const [irccCodes, setIrccCodes] = useState<Readonly<Record<string, string>>>(STANDARD_IRCC_CODES);
  const [customApps, setCustomApps] = useState<readonly CustomApp[]>([]);
  const [flash, setFlash] = useState("");
  const playing = useRef(false);
  const lastSent = useRef(new Map<string, number>());
  const toastTimer = useRef<number>();
  const flashTimer = useRef<number>();
  const shellRef = useRef<HTMLDivElement>(null);
  const modalOpen = helpOpen || pairOpen || shotZoom;

  const show = useCallback((msg: string, err: boolean) => {
    window.clearTimeout(toastTimer.current);
    setToast({ msg, err });
    toastTimer.current = window.setTimeout(() => setToast(null), err ? 3200 : 1500);
  }, []);

  const closeInfo = useCallback(() => {
    setInfoOpen(false);
    setShotZoom(false);
  }, []);

  /* The dialog owns confirmed pairing transitions; they outrank poll results
     that were already in flight. */
  const setPairedFromDialog = useCallback((value: boolean) => {
    setPairedBadge((badge) => confirmPaired(badge, value));
  }, []);

  /** Button feedback contract: haptic pulse + 150ms highlight, single source. */
  const pulse = useCallback((name: string) => {
    window.clearTimeout(flashTimer.current);
    navigator.vibrate?.(8);
    setFlash(name);
    flashTimer.current = window.setTimeout(() => setFlash(""), 150);
  }, []);

  const send = useCallback(
    async (name: string) => {
      const code = irccCodes[name];
      if (!code) return;
      pulse(name);
      const { ok, msg } = await sendKeyCode(code);
      if (!ok) {
        show(msg ?? t("toastSendFailed"), true);
        return;
      }
      // Single source of truth for the optimistic play/pause flag: both the
      // Space shortcut and the ▶/⏸ buttons reconcile it here on success.
      if (name === "Play") playing.current = true;
      if (name === "Pause") playing.current = false;
    },
    [irccCodes, pulse, show],
  );

  const appAction = useCallback(
    (body: AppActionBody, flashName: string) => {
      pulse(flashName);
      const request: Promise<SendResult> = body.back
        ? backApp()
        : body.uri
          ? launchApp(body.uri)
          : Promise.resolve({ ok: false });
      void request.then(({ ok, msg }) => {
        if (!ok) show(msg ?? t("toastActionFailed"), true);
      });
    },
    [pulse, show],
  );

  /* Locale only; status, pairing, IRCC codes, and config are polled below. */
  useEffect(() => {
    applyDocumentLocale();
  }, []);

  /* A dialog write invalidates poll results already in flight; this ref gives
     each tick the generation it started at. Layout effects run before timers,
     so a tick always reads the committed generation. */
  useLayoutEffect(() => {
    pairedBadgeRef.current = pairedBadge;
  }, [pairedBadge]);

  /* Poll status on every tick, pairing until the TV is paired, config and IRCC
     codes until one successful response latches each. The next tick is
     scheduled only after the previous one settles, so requests never overlap. */
  useEffect(() => {
    let pollState = initialPollState;
    let cancelled = false;
    const stop = startPollLoop(
      async () => {
        const tickGeneration = pairedBadgeRef.current.generation;
        const { state, snapshot } = await runPoll(pollState, POLL_FETCHERS);
        if (cancelled) return;
        pollState = state;
        setStatus(snapshot.status);
        if (snapshot.paired !== undefined) {
          const polled = snapshot.paired;
          setPairedBadge((badge) => applyPollPaired(badge, polled, tickGeneration));
        }
        if (snapshot.config !== undefined) setCustomApps(snapshot.config);
        if (snapshot.codes !== undefined) setIrccCodes({ ...STANDARD_IRCC_CODES, ...snapshot.codes });
      },
      {
        schedule: (tick, delayMs) => window.setTimeout(tick, delayMs),
        cancel: (id) => window.clearTimeout(id),
      },
    );
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  /* Keyboard bindings (mapping classified in keys.ts) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      // Typing in a form control is never a remote key or a shortcut.
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
      const action = resolveKeyAction(e, {
        helpOpen,
        pairOpen,
        lightboxOpen: shotZoom,
        infoOpen,
        playing: playing.current,
        customApps,
      });

      // Native Enter/Space activation belongs to the focused button, but a modal
      // only lets it through inside the dialog; background activation is swallowed.
      const button = target?.closest("button");
      if ((e.key === "Enter" || e.key === " ") && button) {
        if (!modalOpen || button.closest('[role="dialog"]')) return;
        e.preventDefault();
        return;
      }
      if (action.kind === "none") return;
      if (action.kind === "toggleHelp") {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (action.kind === "closeHelp") {
        setHelpOpen(false);
        return;
      }
      if (action.kind === "closeLightbox") {
        e.preventDefault();
        setShotZoom(false);
        return;
      }
      if (action.kind === "closeInfo") {
        e.preventDefault();
        closeInfo();
        return;
      }
      if (action.kind === "app" || action.kind === "appBack") {
        e.preventDefault();
        appAction(action.kind === "app" ? { uri: action.uri } : { back: true }, action.flash);
        return;
      }
      const now = performance.now();
      const last = lastSent.current.get(action.name) ?? -1e9;
      if (now - last < (action.repeatable ? 130 : 400)) return;
      if (!action.repeatable && e.repeat) return;
      lastSent.current.set(action.name, now);
      e.preventDefault();
      void send(action.name);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send, appAction, helpOpen, pairOpen, shotZoom, infoOpen, customApps, modalOpen, closeInfo]);

  /* A modal owns keyboard and pointer input: the shell stays inert until it closes. */
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    if (modalOpen) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [modalOpen]);

  const stTxt =
    status === "active" ? t("statusActive") : status === "standby" ? t("statusStandby") : t("statusOffline");

  return (
    <>
      <div ref={shellRef}>
        <header className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="whitespace-nowrap text-base font-semibold">{t("title")}</h1>
          <span
            className={`size-[9px] shrink-0 rounded-full ${
              status === "active"
                ? "bg-status-active shadow-[0_0_6px_color-mix(in_srgb,var(--color-status-active)_53.33%,transparent)]"
                : status === "standby"
                  ? "bg-status-standby shadow-[0_0_6px_color-mix(in_srgb,var(--color-status-standby)_53.33%,transparent)]"
                  : "bg-status-off"
            }`}
          />
          <span className="whitespace-nowrap text-xs text-muted">{stTxt}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" className={HBTN} onClick={() => setPairOpen(true)}>
              {paired ? t("btnPaired") : t("btnPair")}
            </button>
            <button
              type="button"
              className={HBTN}
              onClick={() => {
                setInfoOpen((v) => !v);
                setShotZoom(false);
              }}
            >
              {t("btnInfo")}
            </button>
            <button type="button" className={HBTN} onClick={() => setHelpOpen(true)}>
              {t("btnKeyboard")}
            </button>
            <label className="flex cursor-pointer items-center gap-1.5">
              <span className="whitespace-nowrap text-xs text-muted">{t("langLabel")}</span>
              <span className="relative inline-flex items-center">
                <select
                  className={LANG_SELECT}
                  value={getLangPref()}
                  onChange={(e) => setLangPref(e.target.value as LangPref)}
                >
                  <option value="auto">{t("langAuto")}</option>
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 10 6"
                  className="pointer-events-none absolute right-2.5 h-1.5 w-2.5 text-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1 1l4 4 4-4" />
                </svg>
              </span>
            </label>
          </div>
        </header>

        <div className="flex items-start justify-center gap-3.5">
          <Remote flash={flash} send={(name) => void send(name)} appAction={appAction} customApps={customApps} />
          {infoOpen && <InfoPanel zoomOpen={shotZoom} onZoomChange={setShotZoom} onClose={closeInfo} />}
        </div>
      </div>

      {pairOpen && <PairDialog paired={paired} setPaired={setPairedFromDialog} onClose={() => setPairOpen(false)} />}
      {helpOpen && <HelpDialog customApps={customApps} onClose={() => setHelpOpen(false)} />}
      {toast && (
        <div
          className={`fixed bottom-[calc(26px_+_env(safe-area-inset-bottom))] left-1/2 z-40 max-w-[86vw] -translate-x-1/2 rounded-xl border px-4 py-[9px] text-[13px] shadow-[0_6px_18px_rgba(0,0,0,.5)] ${
            toast.err
              ? "border-danger-line bg-danger-surface text-danger"
              : "border-info-line bg-info-surface text-info-ink"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </>
  );
}
