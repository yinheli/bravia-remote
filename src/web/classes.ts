/** Shared Tailwind class strings; kept as literals so the scanner can see them. */

export const HBTN =
  "cursor-pointer rounded-lg border border-line bg-panel-2 px-2.5 py-[5px] text-xs font-normal text-ink-soft disabled:cursor-default disabled:opacity-50";

export const LANG_SELECT =
  "h-[29px] cursor-pointer appearance-none rounded-lg border border-line bg-panel-2 pr-7 pl-2.5 text-xs leading-4 font-normal text-ink-soft outline-none focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent/60";

const KEY_MOTION =
  "cursor-pointer text-center shadow-[0_2px_3px_rgba(0,0,0,.5),inset_0_1px_0_rgba(255,255,255,.06)] [transition:transform_.04s,filter_.12s] active:translate-y-px active:scale-[.96] active:brightness-[1.3]";

const KEY_CHROME = `${KEY_MOTION} rounded-xl border border-line-strong bg-[linear-gradient(180deg,var(--color-key-hi),var(--color-key-lo))]`;

export const KBTN = `${KEY_CHROME} py-[11px] text-sm text-ink`;
export const KBTN_SMALL = `${KEY_CHROME} px-2 py-2 text-xs text-ink-dim`;
export const KBTN_GROW = `${KBTN_SMALL} flex-1 basis-16`;
export const KBTN_WIDE = `${KBTN} col-span-2`;
export const KBTN_POWER = `${KEY_MOTION} size-[54px] justify-self-center rounded-full border border-[#5c3038] bg-[radial-gradient(circle_at_35%_30%,#6d2a2e,#34141a)] p-0 text-xl text-[#ff8a8d]`;

/** Lit wash + inner shadow; flashes reuse it verbatim so release matches the press frame. */
const PRESSED = "bg-white/[.22] text-white shadow-[inset_0_3px_7px_rgba(0,0,0,.55)]";

export const KEY_FLASH = "translate-y-px scale-[.96] brightness-[1.3]";
/** Pill halves inherit the pill container's clip, so the wash must stay square-cornered. */
export const PILL_FLASH = PRESSED;
/** D-pad arrows are 90° wedges with the OK disc masked out; flash keeps the pressed look. */
export const DPAD_FLASH = PRESSED;
export const OK_FLASH = `-translate-x-1/2 -translate-y-1/2 scale-[.95] ${PRESSED}`;

/** The glyph sinks and shrinks; the fill cannot move without breaking the pill/wedge silhouette. */
export const KEY_LABEL =
  "inline-block [transition:translate_.06s,scale_.06s] group-active:translate-y-[1px] group-active:scale-[.85]";
export const KEY_LABEL_FLASH = "translate-y-[1px] scale-[.85]";

export const PILL_BTN =
  "group cursor-pointer border-0 text-xl text-key-ink-dim active:bg-white/[.22] active:text-white active:shadow-[inset_0_3px_7px_rgba(0,0,0,.55)]";

export const DPAD_BTN =
  "group absolute inset-0 flex cursor-pointer border-0 text-[17px] text-key-ink [mask:radial-gradient(circle_closest-side,transparent_35%,#000_36%)] active:bg-white/[.22] active:text-white active:shadow-[inset_0_3px_7px_rgba(0,0,0,.55)]";

export const OK_BTN =
  "absolute top-1/2 left-1/2 size-[34%] -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-0 text-[17px] font-bold text-key-ink shadow-[0_2px_4px_rgba(0,0,0,.45),inset_0_-1px_2px_rgba(0,0,0,.2)] active:scale-[.95] active:bg-white/[.22] active:text-white active:shadow-[inset_0_3px_7px_rgba(0,0,0,.55)]";

export const OVERLAY = "fixed inset-0 z-30 flex items-center justify-center bg-[rgba(5,7,10,.72)] p-5";

export const SHEET =
  "max-h-[80vh] w-full max-w-[420px] overflow-auto rounded-2xl border border-line bg-panel-2 px-5 py-[18px]";

export const PAIRNAME =
  "mb-2 w-full rounded-[10px] border border-line bg-field px-3 py-2 text-sm text-ink outline-none";

export const PAIRINPUT =
  "my-2 w-full rounded-[10px] border border-line bg-field px-3.5 py-2.5 text-center text-xl tracking-[.5em] text-ink outline-none";
