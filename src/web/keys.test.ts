import { describe, expect, test } from "bun:test";
import { type KeyAction, type KeyContext, resolveKeyAction, STANDARD_IRCC_CODES } from "./keys";

const base: KeyContext = {
  helpOpen: false,
  pairOpen: false,
  lightboxOpen: false,
  infoOpen: false,
  playing: false,
  customApps: [],
};

const key = (
  e: Partial<{
    key: string;
    code: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    repeat: boolean;
  }>,
  ctx?: Partial<KeyContext>,
): KeyAction =>
  resolveKeyAction(
    {
      key: e.key ?? "",
      code: e.code ?? "",
      shiftKey: e.shiftKey ?? false,
      ctrlKey: e.ctrlKey ?? false,
      metaKey: e.metaKey ?? false,
      altKey: e.altKey ?? false,
      repeat: e.repeat ?? false,
    },
    { ...base, ...ctx },
  );

describe("resolveKeyAction", () => {
  test("maps arrows and named keys", () => {
    expect(key({ key: "ArrowUp" })).toMatchObject({ kind: "key", name: "Up", repeatable: true });
    expect(key({ key: "ArrowLeft" })).toMatchObject({ kind: "key", name: "Left", repeatable: true });
    expect(key({ key: "+" })).toMatchObject({ kind: "key", name: "VolumeUp", repeatable: true });
    expect(key({ key: "=" })).toMatchObject({ kind: "key", name: "VolumeUp" });
    expect(key({ key: "]" })).toMatchObject({ kind: "key", name: "ChannelDown", repeatable: true });
    expect(key({ key: "m" })).toMatchObject({ kind: "key", name: "Mute", repeatable: false });
    expect(key({ key: "M" })).toMatchObject({ kind: "key", name: "Mute" });
    expect(key({ key: "t" })).toMatchObject({ kind: "key", name: "Input" });
  });

  test("unknown keys pass through as none", () => {
    expect(key({ key: "z" }).kind).toBe("none");
    expect(key({ key: "F5" }).kind).toBe("none");
  });

  test("digits map to Num keys, shift+digits to HDMI/apps/back", () => {
    expect(key({ code: "Digit5" })).toMatchObject({ kind: "key", name: "Num5" });
    expect(key({ code: "Digit2", shiftKey: true })).toMatchObject({ kind: "key", name: "Hdmi2" });
    expect(key({ code: "Digit0", shiftKey: true })).toMatchObject({ kind: "appBack" });
  });

  test("numpad digits bind like the digit row", () => {
    expect(key({ code: "Numpad5" })).toMatchObject({ kind: "key", name: "Num5" });
    expect(key({ code: "Numpad2", shiftKey: true })).toMatchObject({ kind: "key", name: "Hdmi2" });
    expect(key({ code: "Numpad0", shiftKey: true })).toMatchObject({ kind: "appBack" });
  });

  test("pairing modal swallows every shortcut", () => {
    expect(key({ key: "x" }, { pairOpen: true }).kind).toBe("none");
    expect(key({ key: "?" }, { pairOpen: true }).kind).toBe("none");
    expect(key({ key: "Escape" }, { pairOpen: true }).kind).toBe("none");
    expect(key({ key: " ", code: "Space" }, { pairOpen: true }).kind).toBe("none");
  });

  test("shift+5.. binds configured custom apps in order", () => {
    const ctx = {
      customApps: [
        { name: "A", uri: "a" },
        { name: "B", uri: "b" },
      ],
    };
    expect(key({ code: "Digit5", shiftKey: true }, ctx)).toMatchObject({ kind: "app", uri: "a" });
    expect(key({ code: "Digit6", shiftKey: true }, ctx)).toMatchObject({ kind: "app", uri: "b" });
    expect(key({ code: "Digit7", shiftKey: true }, ctx).kind).toBe("none");
  });

  test("space maps to Play or Pause based on the optimistic flag", () => {
    expect(key({ key: " " })).toMatchObject({ kind: "key", name: "Play" });
    expect(
      resolveKeyAction(
        { key: " ", code: "", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false },
        { ...base, playing: true },
      ),
    ).toMatchObject({ kind: "key", name: "Pause" });
  });

  test("ctrl/meta/alt chords pass through to the browser", () => {
    expect(key({ key: "r", ctrlKey: true }).kind).toBe("none");
    expect(key({ key: "p", ctrlKey: true }).kind).toBe("none");
    expect(key({ key: "f", ctrlKey: true }).kind).toBe("none");
    expect(key({ key: "r", metaKey: true }).kind).toBe("none");
    expect(key({ key: "f", altKey: true }).kind).toBe("none");
    expect(key({ key: "ArrowLeft", ctrlKey: true }).kind).toBe("none");
    expect(key({ code: "Digit3", ctrlKey: true }).kind).toBe("none");
    expect(key({ key: " ", code: "Space", ctrlKey: true }).kind).toBe("none");
    expect(key({ key: "?", ctrlKey: true }).kind).toBe("none");
    expect(key({ key: "Escape", metaKey: true }).kind).toBe("none");
    expect(key({ key: "Escape", ctrlKey: true }, { infoOpen: true }).kind).toBe("none");
    // Shift alone must keep its existing meaning.
    expect(key({ key: "r", shiftKey: true })).toMatchObject({ kind: "key", name: "Rewind" });
    expect(key({ code: "Digit2", shiftKey: true }, {})).toMatchObject({ kind: "key", name: "Hdmi2" });
  });

  test("help overlay swallows keys except Escape", () => {
    expect(key({ key: "ArrowUp" }, { helpOpen: true }).kind).toBe("none");
    expect(key({ key: "Escape" }, { helpOpen: true }).kind).toBe("closeHelp");
    expect(key({ key: "?" }).kind).toBe("toggleHelp");
  });

  test("info panel swallows keys except Escape, which closes it", () => {
    expect(key({ key: "ArrowUp" }, { infoOpen: true }).kind).toBe("none");
    expect(key({ key: "Escape" }, { infoOpen: true }).kind).toBe("closeInfo");
    expect(key({ key: "x" }, { infoOpen: true }).kind).toBe("none");
  });

  test("screenshot lightbox closes before the info panel", () => {
    expect(key({ key: "ArrowUp" }, { lightboxOpen: true, infoOpen: true }).kind).toBe("none");
    expect(key({ key: "?" }, { lightboxOpen: true, infoOpen: true }).kind).toBe("none");
    expect(key({ key: "Escape" }, { lightboxOpen: true, infoOpen: true }).kind).toBe("closeLightbox");
    expect(key({ key: "Escape" }, { lightboxOpen: true }).kind).toBe("closeLightbox");
    expect(key({ key: "Escape" }, { infoOpen: true }).kind).toBe("closeInfo");
  });

  test("help and pairing keep precedence over the lightbox", () => {
    expect(key({ key: "Escape" }, { helpOpen: true, lightboxOpen: true }).kind).toBe("closeHelp");
    expect(key({ key: "x" }, { helpOpen: true, lightboxOpen: true }).kind).toBe("none");
    expect(key({ key: "Escape" }, { pairOpen: true, lightboxOpen: true }).kind).toBe("none");
  });

  test("standard table covers every name reachable from the keyboard", () => {
    for (const name of [
      "Up",
      "Down",
      "Left",
      "Right",
      "VolumeUp",
      "VolumeDown",
      "ChannelUp",
      "ChannelDown",
      "Mute",
      "Display",
      "Input",
      "TvPower",
      "WakeUp",
      "PowerOff",
      "Options",
      "Prev",
      "Next",
      "Rewind",
      "Forward",
      "Stop",
      "Play",
      "Pause",
      "Confirm",
      "Return",
      "Home",
      "Hdmi1",
      "Hdmi2",
      "Hdmi3",
      "Hdmi4",
      "Num1",
      "Num0",
      "Enter",
    ])
      expect(STANDARD_IRCC_CODES[name], name).toBeString();
  });
});
