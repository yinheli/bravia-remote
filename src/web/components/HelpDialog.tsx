/** Keyboard shortcuts overlay; custom app rows follow BRAVIA_APPS. */
import { useId, useRef } from "react";
import { KBTN, OVERLAY, SHEET } from "../classes";
import { useDialogFocus } from "../focus";
import { t } from "../i18n";
import type { CustomApp } from "../keys";

type HelpDialogProps = { customApps: readonly CustomApp[]; onClose: () => void };

const CELL = "border-b border-line-subtle px-1.5 py-1";
const KEY = `${CELL} whitespace-nowrap font-[ui-monospace,monospace] text-hint`;

export function HelpDialog({ customApps, onClose }: HelpDialogProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  useDialogFocus(sheetRef);

  return (
    <div
      className={OVERLAY}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={sheetRef} className={SHEET} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="mb-2.5 text-[15px] font-bold">
          {t("helpTitle")}
        </h2>
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            <tr>
              <td className={KEY}>↑ ↓ ← →</td>
              <td className={CELL}>{t("helpArrows")}</td>
            </tr>
            <tr>
              <td className={KEY}>Enter</td>
              <td className={CELL}>{t("helpOk")}</td>
            </tr>
            <tr>
              <td className={KEY}>Backspace / Esc</td>
              <td className={CELL}>{t("helpBackHome")}</td>
            </tr>
            <tr>
              <td className={KEY}>{t("helpVolumeKeys")}</td>
              <td className={CELL}>{t("helpVolume")}</td>
            </tr>
            <tr>
              <td className={KEY}>[ ]</td>
              <td className={CELL}>{t("helpChannel")}</td>
            </tr>
            <tr>
              <td className={KEY}>M / D</td>
              <td className={CELL}>{t("helpMuteDisplay")}</td>
            </tr>
            <tr>
              <td className={KEY}>0–9</td>
              <td className={CELL}>{t("helpDigits")}</td>
            </tr>
            <tr>
              <td className={KEY}>Shift+1~4</td>
              <td className={CELL}>{t("helpHdmi")}</td>
            </tr>
            {customApps.slice(0, 5).map((app, i) => (
              <tr key={app.uri}>
                <td className={KEY}>{`Shift+${i + 5}`}</td>
                <td className={CELL}>{app.name}</td>
              </tr>
            ))}
            <tr>
              <td className={KEY}>Shift+0</td>
              <td className={CELL}>{t("helpPrevApp")}</td>
            </tr>
            <tr>
              <td className={KEY}>Space</td>
              <td className={CELL}>{t("helpPlayPause")}</td>
            </tr>
            <tr>
              <td className={KEY}>R F S / B N</td>
              <td className={CELL}>{t("helpTransport")}</td>
            </tr>
            <tr>
              <td className={KEY}>O / T / X</td>
              <td className={CELL}>{t("helpOptionsInputPower")}</td>
            </tr>
            <tr>
              <td className={KEY}>W / P</td>
              <td className={CELL}>{t("helpWakePower")}</td>
            </tr>
            <tr>
              <td className={KEY}>?</td>
              <td className={CELL}>{t("helpThis")}</td>
            </tr>
          </tbody>
        </table>
        <button type="button" className={`${KBTN} mt-3 w-full`} onClick={onClose}>
          {t("btnClose")}
        </button>
      </div>
    </div>
  );
}
