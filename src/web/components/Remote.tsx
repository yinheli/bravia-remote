/** The physical remote body: button grid, D-pad, volume/channel pills. */
import type { AppActionBody } from "../api";
import {
  DPAD_BTN,
  DPAD_FLASH,
  KBTN,
  KBTN_GROW,
  KBTN_POWER,
  KBTN_SMALL,
  KBTN_WIDE,
  KEY_FLASH,
  KEY_LABEL,
  KEY_LABEL_FLASH,
  OK_BTN,
  OK_FLASH,
  PILL_BTN,
  PILL_FLASH,
} from "../classes";
import { t } from "../i18n";
import type { CustomApp } from "../keys";

type RemoteProps = {
  flash: string;
  send: (name: string) => void;
  /** Launch an app or go back; `flashName` identifies the button to highlight. */
  appAction: (body: AppActionBody, flashName: string) => void;
  customApps: readonly CustomApp[];
};

const ROW = "mb-2.5 grid grid-cols-3 items-center gap-2";
const ROW_7 = "mb-2.5 grid grid-cols-7 items-center gap-1.5";

/** Each arrow owns a 90° wedge of the pad; clip-path shapes the hit area and the press wash. */
const WEDGE_UP = "items-start justify-center pt-[12%] [clip-path:polygon(50%_50%,0_0,100%_0)]";
const WEDGE_DOWN = "items-end justify-center pb-[12%] [clip-path:polygon(50%_50%,0_100%,100%_100%)]";
const WEDGE_LEFT = "items-center justify-start pl-[12%] [clip-path:polygon(50%_50%,0_0,0_100%)]";
const WEDGE_RIGHT = "items-center justify-end pr-[12%] [clip-path:polygon(50%_50%,100%_0,100%_100%)]";

export function Remote({ flash, send, appAction, customApps }: RemoteProps) {
  const B = (name: string, label: string, cls = KBTN) => (
    <button type="button" key={name} className={`${cls} ${flash === name ? KEY_FLASH : ""}`} onClick={() => send(name)}>
      {label}
    </button>
  );
  const appButton = (app: CustomApp, index: number) => (
    <button
      type="button"
      key={`app-${index}`}
      className={`${KBTN_GROW} ${flash === `app-${index}` ? KEY_FLASH : ""}`}
      onClick={() => appAction({ uri: app.uri }, `app-${index}`)}
    >
      {app.name}
    </button>
  );
  const padButton = (name: string, label: string) => (
    <button
      type="button"
      key={name}
      className={`${PILL_BTN} ${flash === name ? PILL_FLASH : ""}`}
      onClick={() => send(name)}
    >
      <span className={`${KEY_LABEL} ${flash === name ? KEY_LABEL_FLASH : ""}`}>{label}</span>
    </button>
  );
  const dpadButton = (name: string, label: string, wedge: string) => (
    <button
      type="button"
      className={`${DPAD_BTN} ${wedge} ${flash === name ? DPAD_FLASH : ""}`}
      onClick={() => send(name)}
    >
      <span className={`${KEY_LABEL} ${flash === name ? KEY_LABEL_FLASH : ""}`}>{label}</span>
    </button>
  );

  return (
    <div className="max-w-[452px] flex-[1_1_452px] select-none rounded-[34px] border border-line-strong bg-[linear-gradient(180deg,#262b36,#14171e)] px-4 pt-3.5 pb-[22px] shadow-[0_14px_40px_rgba(0,0,0,.55),inset_0_1px_0_rgba(255,255,255,.07),inset_0_-2px_6px_rgba(0,0,0,.4)]">
      <div className="mt-0.5 mb-3 text-center text-xs font-bold tracking-[.45em] text-caption">SONY</div>
      <div className={ROW}>
        {B("Display", t("btnDisplay"), KBTN_SMALL)}
        {B("TvPower", "⏻", KBTN_POWER)}
        {B("PicOff", t("btnScreenOff"), KBTN_SMALL)}
      </div>
      <div className={ROW}>
        {B("Num1", "1")}
        {B("Num2", "2")}
        {B("Num3", "3")}
        {B("Num4", "4")}
        {B("Num5", "5")}
        {B("Num6", "6")}
        {B("Num7", "7")}
        {B("Num8", "8")}
        {B("Num9", "9")}
        {B("Num0", "0")}
        {B("Enter", "ENTER", KBTN_WIDE)}
      </div>

      <div className="mb-2.5 grid grid-cols-[76px_1fr_76px] items-center gap-2">
        <div className="flex flex-col gap-[5px]">
          <div className="relative grid h-[168px] grid-rows-2 overflow-hidden rounded-[40px] border border-line-strong bg-[linear-gradient(180deg,var(--color-key-hi),var(--color-key-lo))] shadow-[0_2px_3px_rgba(0,0,0,.5),inset_0_1px_0_rgba(255,255,255,.06)]">
            {padButton("VolumeUp", "+")}
            <span className="absolute top-1/2 right-[14%] left-[14%] h-px bg-line-strong" />
            {padButton("VolumeDown", "−")}
          </div>
          <div className="mt-[5px] text-center text-[10px] tracking-[.2em] text-faint">VOL</div>
          {B("Mute", t("btnMute"), KBTN_SMALL)}
        </div>
        <div className="flex flex-col items-center">
          <div className="relative aspect-square w-full max-w-[216px] overflow-hidden rounded-full border border-[#3f4759] bg-[radial-gradient(circle_at_50%_38%,#343b4b,#1a1e27)] shadow-[0_3px_6px_rgba(0,0,0,.5),inset_0_1px_0_rgba(255,255,255,.06)]">
            {dpadButton("Up", "▲", WEDGE_UP)}
            {dpadButton("Left", "◀", WEDGE_LEFT)}
            {dpadButton("Right", "▶", WEDGE_RIGHT)}
            {dpadButton("Down", "▼", WEDGE_DOWN)}
            <button
              type="button"
              className={`${OK_BTN} ${flash === "Confirm" ? OK_FLASH : ""}`}
              onClick={() => send("Confirm")}
            >
              OK
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-[5px]">
          <div className="relative grid h-[168px] grid-rows-2 overflow-hidden rounded-[40px] border border-line-strong bg-[linear-gradient(180deg,var(--color-key-hi),var(--color-key-lo))] shadow-[0_2px_3px_rgba(0,0,0,.5),inset_0_1px_0_rgba(255,255,255,.06)]">
            {padButton("ChannelUp", "▲")}
            <span className="absolute top-1/2 right-[14%] left-[14%] h-px bg-line-strong" />
            {padButton("ChannelDown", "▼")}
          </div>
          <div className="mt-[5px] text-center text-[10px] tracking-[.2em] text-faint">CH</div>
          {B("Input", t("btnInput"), KBTN_SMALL)}
        </div>
      </div>

      <div className={ROW}>
        {B("Return", t("btnReturn"), KBTN_SMALL)}
        {B("Home", t("btnHome"), KBTN_SMALL)}
        {B("Options", t("btnOptions"), KBTN_SMALL)}
      </div>
      <div className={ROW_7}>
        {B("Prev", "⏮\uFE0E", KBTN_SMALL)}
        {B("Rewind", "⏪\uFE0E", KBTN_SMALL)}
        {B("Play", "▶\uFE0E", KBTN_SMALL)}
        {B("Pause", "⏸\uFE0E", KBTN_SMALL)}
        {B("Stop", "⏹\uFE0E", KBTN_SMALL)}
        {B("Forward", "⏩\uFE0E", KBTN_SMALL)}
        {B("Next", "⏭\uFE0E", KBTN_SMALL)}
      </div>
      <div className="mb-2.5 grid grid-cols-4 items-center gap-1.5">
        {B("Hdmi1", "HDMI1", KBTN_SMALL)}
        {B("Hdmi2", "HDMI2", KBTN_SMALL)}
        {B("Hdmi3", "HDMI3", KBTN_SMALL)}
        {B("Hdmi4", "HDMI4", KBTN_SMALL)}
      </div>
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {customApps.map(appButton)}
        <button
          type="button"
          key="appback"
          className={`${KBTN_GROW} ${flash === "appback" ? KEY_FLASH : ""}`}
          onClick={() => appAction({ back: true }, "appback")}
        >
          {t("btnPrevApp")}
        </button>
        {B("Exit", t("btnExit"), KBTN_GROW)}
      </div>
    </div>
  );
}
