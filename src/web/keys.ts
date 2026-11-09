/**
 * Remote-control key codes and keyboard bindings for the web UI.
 * The standard table mirrors the Bravia IRCC code set; codes fetched live from
 * the TV (`getRemoteControllerInfo` via /api/codes) take precedence.
 */
import type { CustomApp } from "../shared/apps";

export type { CustomApp };

/** Standard Bravia base64 IRCC payloads (13 bytes); live TV codes take precedence. */
export const STANDARD_IRCC_CODES: Readonly<Record<string, string>> = {
  TvPower: "AAAAAQAAAAEAAAAVAw==",
  WakeUp: "AAAAAQAAAAEAAAAuAw==",
  PowerOff: "AAAAAQAAAAEAAAAvAw==",
  PicOff: "AAAAAQAAAAEAAAA+Aw==",
  Display: "AAAAAQAAAAEAAAA6Aw==",
  Mute: "AAAAAQAAAAEAAAAUAw==",
  VolumeUp: "AAAAAQAAAAEAAAASAw==",
  VolumeDown: "AAAAAQAAAAEAAAATAw==",
  ChannelUp: "AAAAAQAAAAEAAAAQAw==",
  ChannelDown: "AAAAAQAAAAEAAAARAw==",
  Up: "AAAAAQAAAAEAAAB0Aw==",
  Down: "AAAAAQAAAAEAAAB1Aw==",
  Left: "AAAAAQAAAAEAAAA0Aw==",
  Right: "AAAAAQAAAAEAAAAzAw==",
  Confirm: "AAAAAQAAAAEAAABlAw==",
  Return: "AAAAAgAAAJcAAAAjAw==",
  Home: "AAAAAQAAAAEAAABgAw==",
  Exit: "AAAAAQAAAAEAAABjAw==",
  Options: "AAAAAgAAAJcAAAA2Aw==",
  Input: "AAAAAQAAAAEAAAArAw==",
  Num1: "AAAAAQAAAAEAAAAAAw==",
  Num2: "AAAAAQAAAAEAAAABAw==",
  Num3: "AAAAAQAAAAEAAAACAw==",
  Num4: "AAAAAQAAAAEAAAADAw==",
  Num5: "AAAAAQAAAAEAAAAEAw==",
  Num6: "AAAAAQAAAAEAAAAFAw==",
  Num7: "AAAAAQAAAAEAAAAGAw==",
  Num8: "AAAAAQAAAAEAAAAHAw==",
  Num9: "AAAAAQAAAAEAAAAIAw==",
  Num0: "AAAAAQAAAAEAAAAJAw==",
  Enter: "AAAAAQAAAAEAAAALAw==",
  Prev: "AAAAAgAAAJcAAAA8Aw==",
  Next: "AAAAAgAAAJcAAAA9Aw==",
  Rewind: "AAAAAgAAAJcAAAAbAw==",
  Forward: "AAAAAgAAAJcAAAAcAw==",
  Play: "AAAAAgAAAJcAAAAaAw==",
  Pause: "AAAAAgAAAJcAAAAZAw==",
  Stop: "AAAAAgAAAJcAAAAYAw==",
  Hdmi1: "AAAAAgAAABoAAABaAw==",
  Hdmi2: "AAAAAgAAABoAAABbAw==",
  Hdmi3: "AAAAAgAAABoAAABcAw==",
  Hdmi4: "AAAAAgAAABoAAABdAw==",
};

export type KeyAction =
  | { kind: "none" }
  | { kind: "toggleHelp" }
  | { kind: "closeHelp" }
  | { kind: "closeLightbox" }
  | { kind: "closeInfo" }
  | { kind: "key"; name: string; repeatable: boolean }
  | { kind: "app"; uri: string; flash: string }
  | { kind: "appBack"; flash: string };

export type KeyEvent = {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
};

export type KeyContext = {
  /** Help overlay visible: only Escape passes through. */
  helpOpen: boolean;
  /** Pairing modal open: all shortcuts are swallowed (no TV input mid-pairing). */
  pairOpen: boolean;
  /** Screenshot lightbox open: only Escape passes through and closes it first. */
  lightboxOpen: boolean;
  /** Info panel open: shortcuts are swallowed (Escape closes the panel). */
  infoOpen: boolean;
  /** Play/pause toggles based on this optimistic flag. */
  playing: boolean;
  /** Apps configured via BRAVIA_APPS; the first five get Shift+5…9. */
  customApps: readonly CustomApp[];
};

/** Physical keyboard → remote key names. */
const KEYS: Readonly<Record<string, string>> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Confirm",
  Backspace: "Return",
  Escape: "Home",
  "+": "VolumeUp",
  "=": "VolumeUp",
  "-": "VolumeDown",
  "[": "ChannelUp",
  "]": "ChannelDown",
  m: "Mute",
  d: "Display",
  p: "TvPower",
  w: "WakeUp",
  x: "PowerOff",
  t: "Input",
  o: "Options",
  b: "Prev",
  n: "Next",
  r: "Rewind",
  f: "Forward",
  s: "Stop",
};

/** Keys that auto-repeat while held (with a shorter throttle). */
const REPEATABLE: Readonly<Record<string, true>> = {
  Up: true,
  Down: true,
  Left: true,
  Right: true,
  VolumeUp: true,
  VolumeDown: true,
  ChannelUp: true,
  ChannelDown: true,
};

/**
 * Pure classifier for keydown events (no DOM access) so the mapping is
 * unit-testable. The caller owns preventDefault and throttle handling.
 */
export function resolveKeyAction(e: KeyEvent, ctx: KeyContext): KeyAction {
  // Ctrl/Cmd/Alt chords belong to the browser or OS (reload, print, find, tab
  // switching): never consume them as TV input. Shift stays meaningful below.
  if (e.ctrlKey || e.metaKey || e.altKey) return { kind: "none" };
  if (ctx.helpOpen) return e.key === "Escape" ? { kind: "closeHelp" } : { kind: "none" };
  if (ctx.pairOpen) return { kind: "none" };
  if (ctx.lightboxOpen) return e.key === "Escape" ? { kind: "closeLightbox" } : { kind: "none" };
  if (ctx.infoOpen) return e.key === "Escape" ? { kind: "closeInfo" } : { kind: "none" };
  if (e.key === "?") return { kind: "toggleHelp" };

  const digitMatch = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  if (digitMatch) {
    const digit = digitMatch[1] ?? "";
    if (e.shiftKey) {
      if (digit >= "1" && digit <= "4") return { kind: "key", name: `Hdmi${digit}`, repeatable: false };
      if (digit === "0") return { kind: "appBack", flash: "appback" };
      const index = Number(digit) - 5;
      const app = Number.isInteger(index) && index >= 0 ? ctx.customApps[index] : undefined;
      return app ? { kind: "app", uri: app.uri, flash: `app-${index}` } : { kind: "none" };
    }
    return { kind: "key", name: `Num${digit}`, repeatable: false };
  }

  if (e.key === " ") return { kind: "key", name: ctx.playing ? "Pause" : "Play", repeatable: false };

  const name = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
  if (!name) return { kind: "none" };
  return { kind: "key", name, repeatable: REPEATABLE[name] === true };
}
