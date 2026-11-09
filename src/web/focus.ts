/** Modal focus contract: initial focus, Tab containment, focus restore. */
import { type RefObject, useEffect } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Keep keyboard focus inside a mounted dialog. On mount, focus an `autofocus`
 * field or the first focusable control; on unmount, restore the previous focus
 * on the next frame (the shell clears `inert` in its own commit).
 */
export function useDialogFocus(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = (): HTMLElement[] =>
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first?.focus();
      }
    };

    if (!root.contains(document.activeElement)) {
      (root.querySelector<HTMLElement>("[autofocus]") ?? focusables()[0] ?? root).focus();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      requestAnimationFrame(() => {
        if (restore?.isConnected) restore.focus();
      });
    };
  }, [ref]);
}
