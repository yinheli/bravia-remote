/** TV info side panel: device/volume/playing/input state plus adb screenshot. */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchInfo, fetchScreenshot, shotFailureText } from "../api";
import { HBTN } from "../classes";
import { useDialogFocus } from "../focus";
import { t } from "../i18n";
import { errText, type InfoView, inputDisplayName, parseInfo } from "../parse";

type SecProps = {
  title: string;
  /** Optional help affordance: a `?` button with a hover/focus/tap tooltip. */
  help?: { label: string; text: string };
  children: React.ReactNode;
};

function Sec({ title, help, children }: SecProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const hovered = useRef(false);
  const tipId = useId();

  return (
    <div className="mb-[13px]">
      <h3 className="relative mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-[.1em] text-faint">
        {title}
        {help && (
          <>
            <button
              type="button"
              className="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line-strong text-[10px] leading-none font-normal tracking-normal text-muted hover:text-ink-dim focus-visible:border-accent focus-visible:outline-none"
              aria-label={help.label}
              aria-expanded={helpOpen}
              aria-describedby={helpOpen ? tipId : undefined}
              onPointerEnter={(e) => {
                if (e.pointerType !== "mouse") return;
                hovered.current = true;
                setHelpOpen(true);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType !== "mouse") return;
                hovered.current = false;
                setHelpOpen(false);
              }}
              onClick={() => {
                if (!hovered.current) setHelpOpen((v) => !v);
              }}
              onBlur={() => {
                if (!hovered.current) setHelpOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Escape" || !helpOpen) return;
                e.preventDefault();
                e.stopPropagation();
                setHelpOpen(false);
              }}
            >
              <span aria-hidden="true">?</span>
            </button>
            {helpOpen && (
              <span
                id={tipId}
                role="tooltip"
                className="absolute top-full left-0 z-30 mt-1 block w-60 max-w-full rounded-lg border border-line-strong bg-field px-3 py-2 text-[11px] leading-[1.55] font-normal tracking-normal text-ink-dim shadow-[0_8px_24px_rgba(0,0,0,.55)]"
              >
                {help.text}
              </span>
            )}
          </>
        )}
      </h3>
      {children}
    </div>
  );
}

const MUT = "text-xs text-faint";
const KV = "flex justify-between gap-2.5 py-0.5";

type InfoPanelProps = {
  onClose: () => void;
  zoomOpen: boolean;
  onZoomChange: (open: boolean) => void;
};

/** Full-screen screenshot viewer; portaled so the inert shell cannot contain it. */
function ShotLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref);
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={t("screenshotZoomAlt")}
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-[rgba(8,10,16,.88)]"
      onClick={onClose}
    >
      <img
        className="max-h-[94vh] max-w-[94vw] rounded-md border border-line-strong"
        src={src}
        alt={t("screenshotZoomAlt")}
      />
    </div>,
    document.body,
  );
}

export function InfoPanel({ onClose, zoomOpen, onZoomChange }: InfoPanelProps) {
  const [info, setInfo] = useState<InfoView | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [tick, setTick] = useState(0);
  const [shot, setShot] = useState<string | null>(null);
  const [shotMsg, setShotMsg] = useState("");
  const [shotBusy, setShotBusy] = useState(false);
  const shotUrl = useRef<string | null>(null);
  /** A capture can resolve after the panel closes; then it owns nothing to show. */
  const live = useRef(true);

  /* Revoke the current object URL when the panel unmounts and stop late captures. */
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (shotUrl.current) URL.revokeObjectURL(shotUrl.current);
    };
  }, []);

  /* Load once when opened, then only on manual refresh. `tick` is a pure
     refetch trigger, deliberately not read inside the effect. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is a manual-refresh trigger, not a value dependency
  useEffect(() => {
    let stop = false;
    setLoadErr(false);
    fetchInfo()
      .then((raw) => {
        if (stop) return;
        if (raw !== undefined && raw !== null) setInfo(parseInfo(raw));
        else setLoadErr(true);
      })
      .catch(() => {
        if (!stop) setLoadErr(true);
      });
    return () => {
      stop = true;
    };
  }, [tick]);

  const screenshot = async () => {
    setShotBusy(true);
    setShotMsg(t("shotInProgress"));
    try {
      const result = await fetchScreenshot();
      if (!live.current) return;
      if (result.ok) {
        if (shotUrl.current) URL.revokeObjectURL(shotUrl.current);
        const url = URL.createObjectURL(result.blob);
        shotUrl.current = url;
        setShot(url);
        setShotMsg("");
      } else {
        setShotMsg(shotFailureText(result));
      }
    } catch (e) {
      if (live.current) setShotMsg(t("shotFailed", { text: String(e) }));
    } finally {
      if (live.current) setShotBusy(false);
    }
  };

  return (
    <>
      <aside className="min-w-[250px] flex-[0_1_300px] rounded-2xl border border-line bg-panel px-4 py-3.5 text-[13px] max-[900px]:fixed max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-20 max-[900px]:w-[min(330px,88vw)] max-[900px]:overflow-auto max-[900px]:rounded-r-none max-[900px]:rounded-l-2xl max-[900px]:shadow-[-14px_0_44px_rgba(0,0,0,.55)]">
        <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold">
          {t("infoTitle")}
          <button type="button" className={HBTN} onClick={() => setTick((x) => x + 1)}>
            {t("btnRefresh")}
          </button>
          <button type="button" className={HBTN} disabled={shotBusy} onClick={() => void screenshot()}>
            {shotBusy ? t("shotInProgress") : t("btnScreenshot")}
          </button>
          <button type="button" className={`${HBTN} ml-auto`} aria-label={t("btnClose")} onClick={onClose}>
            ×
          </button>
        </div>
        {loadErr ? (
          <div className={MUT}>{t("infoLoadFailed")}</div>
        ) : !info ? (
          <div className={MUT}>{t("loading")}</div>
        ) : (
          <>
            <Sec title={t("secPower")}>
              <div className={KV}>
                <span className="text-muted">{t("kStatus")}</span>
                <b>
                  {info.pwErr
                    ? errText(info.pwErr)
                    : info.power
                      ? info.power.status === "active"
                        ? t("statusActive")
                        : info.power.status === "standby"
                          ? t("statusStandby")
                          : info.power.status
                      : t("statusOffline")}
                </b>
              </div>
              <div className={KV}>
                <span className="text-muted">{t("kPowerSaving")}</span>
                <span>{info.powerSaving ?? "—"}</span>
              </div>
            </Sec>
            <Sec title={t("secDevice")}>
              <div className={KV}>
                <span className="text-muted">{t("kModel")}</span>
                <span>{info.model ?? "—"}</span>
              </div>
              <div className={KV}>
                <span className="text-muted">{t("kBrand")}</span>
                <span>{info.product ?? "—"}</span>
              </div>
              <div className={KV}>
                <span className="text-muted">{t("kIfaceVer")}</span>
                <span>{info.ifaceVer ?? "—"}</span>
              </div>
            </Sec>
            <Sec title={t("secVolume")}>
              {info.volErr ? (
                <div className={MUT}>{errText(info.volErr)}</div>
              ) : (
                info.vols.map((v) => (
                  <div key={v.target}>
                    <div className="flex justify-between text-xs text-ink-dim">
                      <span>{v.target === "speaker" ? t("speaker") : v.target}</span>
                      <span>{v.mute ? t("muted") : v.volume}</span>
                    </div>
                    <div className="mt-[5px] mb-[9px] h-1.5 overflow-hidden rounded bg-line-subtle">
                      <i className="block h-full rounded bg-accent" style={{ width: `${v.mute ? 0 : v.volume}%` }} />
                    </div>
                  </div>
                ))
              )}
            </Sec>
            <Sec title={t("secPlaying")}>
              {info.playErr ? (
                <div className={MUT}>{errText(info.playErr)}</div>
              ) : info.playing ? (
                <>
                  <div className={KV}>
                    <span className="text-muted">{t("kTitle")}</span>
                    <span>{info.playing.title ?? "—"}</span>
                  </div>
                  <div className={KV}>
                    <span className="text-muted">{t("kSource")}</span>
                    <span>{info.playing.source ?? "—"}</span>
                  </div>
                </>
              ) : (
                <div className={MUT}>{t("noContentInfo")}</div>
              )}
            </Sec>
            <Sec title={t("secInputs")} help={{ label: t("inputsHelpLabel"), text: t("inputsHelp") }}>
              {info.inErr ? (
                <div className={MUT}>{errText(info.inErr)}</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {info.inputs.map((inp) => (
                    <span
                      key={inp.uri}
                      className={`rounded-lg border px-[9px] py-1 text-[11px] ${
                        inp.connection ? "border-success-line text-success" : "border-line text-ink-dim"
                      }`}
                    >
                      {inputDisplayName(inp)}
                    </span>
                  ))}
                </div>
              )}
            </Sec>
            <Sec title={t("secTime")}>
              <div className={KV}>
                <span>{info.time ?? "—"}</span>
              </div>
            </Sec>
            <Sec title={t("secPicture")}>
              {shotMsg && <div className={MUT}>{shotMsg}</div>}
              {shot ? (
                <img
                  className="block w-full cursor-zoom-in rounded-md border border-line-strong"
                  src={shot}
                  alt={t("screenshotAlt")}
                  title={t("screenshotAlt")}
                  onClick={() => onZoomChange(true)}
                />
              ) : (
                !shotMsg && <div className={MUT}>{t("notCaptured")}</div>
              )}
            </Sec>
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted">{t("rawJson")}</summary>
              <pre className="mt-2 max-h-[220px] overflow-auto text-[11px] text-caption">
                {JSON.stringify(info.raw, null, 2)}
              </pre>
            </details>
          </>
        )}
      </aside>
      {zoomOpen && shot && <ShotLightbox src={shot} onClose={() => onZoomChange(false)} />}
    </>
  );
}
