/**
 * Minimal dependency-free i18n for the web UI.
 *
 * - `zh` is the source of truth; `en` must implement every key (enforced by
 *   the `Record<keyof typeof zh, string>` typing).
 * - The user can pin a language; otherwise it is detected from browser
 *   settings, with zh as the fallback for unsupported locales.
 * - Placeholders use `{name}` syntax and are filled via `t(key, vars)`.
 */

export type Lang = "zh" | "en";
export type LangPref = "auto" | Lang;

const zh = {
  title: "BRAVIA 遥控",

  /* Access gate */
  authTitle: "需要访问令牌",
  authHint:
    "输入服务端生成的访问令牌。启动日志会打印令牌文件位置；相关设置见 .env.example 的 BRAVIA_TOKEN_FILE / BRAVIA_TOKEN。",
  authPlaceholder: "访问令牌",
  authUnlock: "解锁",
  authInvalid: "令牌不正确",
  authExpired: "会话已过期，请重新输入访问令牌",

  /* Header */
  statusActive: "使用中",
  statusStandby: "待机",
  statusOffline: "离线",
  btnPair: "配对",
  btnPaired: "已配对",
  btnInfo: "信息",
  btnKeyboard: "键盘 ⌨",
  langLabel: "语言",
  langAuto: "自动",

  /* Remote buttons */
  btnDisplay: "显示",
  btnScreenOff: "熄屏",
  btnMute: "静音",
  btnReturn: "返回",
  btnHome: "主页",
  btnOptions: "选项",
  btnInput: "输入",
  btnPrevApp: "上个",
  btnExit: "退出",

  /* Toasts / generic errors */
  toastSendFailed: "发送失败",
  toastActionFailed: "操作失败",
  toastActionFailedCode: "操作失败（{code}）",
  errConnectServer: "无法连接服务器",
  errConnectTv: "无法连接电视",
  errNoPrevApp: "没有上一个应用",
  errSendCode: "错误 {code}：{text}",
  errHttp: "HTTP {status}",
  errForbidden: "请求被拒绝（跨源访问保护）",
  irccUnsupported: "电视拒绝该按键（固件不支持）",

  /* Pair dialog */
  pairTitle: "配对电视",
  pairPinTab: "PIN 配对",
  pairPskTab: "PSK 密钥",
  pairPairedMsg: "已配对，可直接使用遥控",
  pairRePair: "重新配对",
  btnClose: "关闭",
  pairPinSteps:
    "1. 确保电视处于开机亮屏状态\n2. 点击「开始配对」，电视屏幕会弹出 4 位注册号\n3. 输入注册号完成绑定（电视上显示的设备名见下方输入框）",
  pairNamePlaceholder: "设备名称（默认主机名）",
  pairPinPlaceholder: "4 位注册号",
  pairPskPlaceholder: "PSK 密钥",
  pairStart: "开始配对",
  pairSubmitPin: "提交注册号",
  pairRetry: "重试",
  pairPskSave: "验证并保存",
  pairPskHint: "电视设置 → 网络 → 家庭网络设置 → IP控制 → 预设共享密钥\n输入电视上设置的密钥，验证通过后保存在本机。",
  pairOkPin: "配对成功，遥控已可用",
  pairOkPsk: "PSK 已验证并保存，遥控可用",
  pairNeedKeyFirst: "电视屏幕已显示 4 位注册号，请输入",
  pairNeedKeyRetry: "注册号不正确或已过期，请以电视当前显示的为准重新输入",
  pairStandby: "电视待机中，请先打开电视再配对",
  pairFailed: "配对失败（{code}）：{text}",
  pairPskFailed: "{text}（{code}）",
  pskInvalid: "密钥无效或电视未开启 PSK 认证",
  pskVerifyFailed: "验证失败",

  /* Info panel */
  infoTitle: "电视信息",
  btnRefresh: "刷新",
  btnScreenshot: "截屏",
  shotInProgress: "截取中…",
  loading: "加载中…",
  infoLoadFailed: "无法获取电视信息",
  rawJson: "原始 JSON",
  secPower: "电源",
  secDevice: "设备",
  secVolume: "音量",
  secPlaying: "正在播放",
  secInputs: "输入源",
  inputsHelpLabel: "关于输入源名称",
  inputsHelp:
    "名称由电视返回：优先使用电视上设置的自定义名称，否则使用默认名称；均按电视语言原样显示，不随界面语言翻译。原始字段见下方「原始 JSON」。",
  secTime: "电视时间",
  secPicture: "画面",
  kStatus: "状态",
  kPowerSaving: "省电模式",
  kModel: "型号",
  kBrand: "品牌",
  kIfaceVer: "接口版本",
  kTitle: "标题",
  kSource: "来源",
  speaker: "扬声器",
  muted: "已静音",
  noContentInfo: "无内容信息",
  notCaptured: "未截取",
  screenshotAlt: "电视画面截图",
  screenshotZoomAlt: "电视画面截图（放大）",
  shotFailed: "截屏失败：{text}",
  shotScreencapFailed: "截屏失败（adb 报错）",
  shotTimeout: "截取超时",
  shotTooSmall: "输出过小（{bytes}B）",
  adbMissing: "adb 不可用：未找到 adb（可用 BRAVIA_ADB 指定路径）",

  /* Protocol error text */
  errStandby: "待机中，亮屏后可用",
  errNoContent: "当前输入源不提供内容信息",
  errPairingNeeded: "需配对认证",
  errUnavailable: "不可用（{code}）",

  /* Help dialog */
  helpTitle: "键盘快捷键（长按方向/音量/频道自动连发）",
  helpArrows: "方向键",
  helpOk: "OK 确认",
  helpBackHome: "返回 / 主页",
  helpVolumeKeys: "+ −（或 =）",
  helpVolume: "音量增减",
  helpChannel: "频道上下",
  helpMuteDisplay: "静音 / 显示信息",
  helpDigits: "数字按键",
  helpHdmi: "HDMI 1–4",
  helpPrevApp: "上个应用",
  helpPlayPause: "播放 ⇄ 暂停",
  helpTransport: "倒带 快进 停止 / 上一下一",
  helpOptionsInputPower: "选项 / 输入源 / 关机",
  helpWakePower: "开机 / 电源键",
  helpThis: "本帮助",
} as const;

export type TKey = keyof typeof zh;

const en: Record<TKey, string> = {
  title: "BRAVIA Remote",

  authTitle: "Access token required",
  authHint:
    "Enter the server token. The server logs its file location at startup; see BRAVIA_TOKEN_FILE / BRAVIA_TOKEN in .env.example.",
  authPlaceholder: "Access token",
  authUnlock: "Unlock",
  authInvalid: "Invalid token",
  authExpired: "Session expired. Enter the access token again.",

  statusActive: "Active",
  statusStandby: "Standby",
  statusOffline: "Offline",
  btnPair: "Pair",
  btnPaired: "Paired",
  btnInfo: "Info",
  btnKeyboard: "Keys ⌨",
  langLabel: "Language",
  langAuto: "Auto",

  btnDisplay: "Display",
  btnScreenOff: "Screen off",
  btnMute: "Mute",
  btnReturn: "Return",
  btnHome: "Home",
  btnOptions: "Options",
  btnInput: "Input",
  btnPrevApp: "Prev app",
  btnExit: "Exit",

  toastSendFailed: "Send failed",
  toastActionFailed: "Action failed",
  toastActionFailedCode: "Action failed ({code})",
  errConnectServer: "Cannot reach the server",
  errConnectTv: "Cannot reach the TV",
  errNoPrevApp: "No previous app",
  errSendCode: "Error {code}: {text}",
  errHttp: "HTTP {status}",
  errForbidden: "Request rejected (cross-origin protection)",
  irccUnsupported: "TV rejected this key (firmware may not support it)",

  pairTitle: "Pair TV",
  pairPinTab: "PIN pairing",
  pairPskTab: "PSK key",
  pairPairedMsg: "Paired. The remote is ready to use.",
  pairRePair: "Re-pair",
  btnClose: "Close",
  pairPinSteps:
    "1. Make sure the TV is on with the screen awake\n2. Click “Start pairing” — a 4-digit registration key appears on the TV\n3. Enter the key to finish binding (the device name shown on the TV is in the field below)",
  pairNamePlaceholder: "Device name (default: hostname)",
  pairPinPlaceholder: "4-digit key",
  pairPskPlaceholder: "PSK",
  pairStart: "Start pairing",
  pairSubmitPin: "Submit key",
  pairRetry: "Retry",
  pairPskSave: "Verify & save",
  pairPskHint:
    "TV settings → Network → Home Network Setup → IP Control → Pre-Shared Key\nEnter the key configured on the TV; it is stored locally after verification.",
  pairOkPin: "Paired. The remote is ready to use.",
  pairOkPsk: "PSK verified and saved. The remote is ready to use.",
  pairNeedKeyFirst: "A 4-digit registration key is shown on the TV — enter it here",
  pairNeedKeyRetry: "Wrong or expired key. Use the one currently shown on the TV.",
  pairStandby: "The TV is in standby — turn it on before pairing",
  pairFailed: "Pairing failed ({code}): {text}",
  pairPskFailed: "{text} ({code})",
  pskInvalid: "Invalid key, or PSK auth is not enabled on the TV",
  pskVerifyFailed: "Verification failed",

  infoTitle: "TV info",
  btnRefresh: "Refresh",
  btnScreenshot: "Screenshot",
  shotInProgress: "Capturing…",
  loading: "Loading…",
  infoLoadFailed: "Could not load TV info",
  rawJson: "Raw JSON",
  secPower: "Power",
  secDevice: "Device",
  secVolume: "Volume",
  secPlaying: "Now playing",
  secInputs: "Inputs",
  inputsHelpLabel: "About input names",
  inputsHelp:
    "Names come from the TV: the custom input label when set, otherwise the TV default. They stay in the TV's language and are not translated by the UI language. Raw fields are under Raw JSON below.",
  secTime: "TV time",
  secPicture: "Picture",
  kStatus: "Status",
  kPowerSaving: "Power saving",
  kModel: "Model",
  kBrand: "Brand",
  kIfaceVer: "API version",
  kTitle: "Title",
  kSource: "Source",
  speaker: "Speaker",
  muted: "Muted",
  noContentInfo: "No content info",
  notCaptured: "Not captured",
  screenshotAlt: "TV screenshot",
  screenshotZoomAlt: "TV screenshot (zoomed)",
  shotFailed: "Screenshot failed: {text}",
  shotScreencapFailed: "Screenshot failed (adb error)",
  shotTimeout: "Capture timed out",
  shotTooSmall: "Output too small ({bytes}B)",
  adbMissing: "adb not found — install adb or point BRAVIA_ADB at its path",

  errStandby: "Standby — wake the screen first",
  errNoContent: "Current input provides no content info",
  errPairingNeeded: "Pairing required",
  errUnavailable: "Unavailable ({code})",

  helpTitle: "Keyboard shortcuts (hold arrows/volume/channel to auto-repeat)",
  helpArrows: "Arrow keys",
  helpOk: "OK / confirm",
  helpBackHome: "Return / Home",
  helpVolumeKeys: "+ − (or =)",
  helpVolume: "Volume up / down",
  helpChannel: "Channel up / down",
  helpMuteDisplay: "Mute / Display",
  helpDigits: "Number keys",
  helpHdmi: "HDMI 1–4",
  helpPrevApp: "Previous app",
  helpPlayPause: "Play ⇄ Pause",
  helpTransport: "Rewind Fast-forward Stop / Prev Next",
  helpOptionsInputPower: "Options / Input / Power off",
  helpWakePower: "Wake / Power",
  helpThis: "This help",
};

const DICTS: Record<Lang, Record<TKey, string>> = { zh, en };

/** Exposed for tests (zh/en placeholder-set parity checks). */
export const dictionaries = DICTS;

/** Storage key for a pinned language; absent means detect from the browser. */
const LANG_KEY = "bravia.lang";

/** Rank BCP-47 tags and pick the first supported language; zh is the fallback. */
export const detectLang = (tags: readonly string[]): Lang => {
  for (const tag of tags) {
    const primary = tag.trim().toLowerCase().split("-")[0];
    if (primary === "zh") return "zh";
    if (primary === "en") return "en";
  }
  return "zh";
};

const browserTags = (): string[] => {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return [...(nav?.languages ?? []), nav?.language ?? ""].filter(Boolean);
};

const readPref = (): LangPref => {
  try {
    const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(LANG_KEY);
    return stored === "zh" || stored === "en" ? stored : "auto";
  } catch {
    return "auto";
  }
};

let pref: LangPref = readPref();
let lang: Lang = pref === "auto" ? detectLang(browserTags()) : pref;

const listeners = new Set<() => void>();

/** Subscribe to language changes; returns unsubscribe. */
export const subscribeLang = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Pinned language preference (`auto` follows the browser). */
export const getLangPref = (): LangPref => pref;

/** Current effective UI language. */
export const getLang = (): Lang => lang;

/** Pin or unpin the UI language and notify the UI. */
export const setLangPref = (next: LangPref): void => {
  pref = next;
  lang = next === "auto" ? detectLang(browserTags()) : next;
  try {
    if (next === "auto") localStorage.removeItem(LANG_KEY);
    else localStorage.setItem(LANG_KEY, next);
  } catch {
    // Ignore storage errors (disabled/private mode).
  }
  applyDocumentLocale();
  for (const listener of listeners) listener();
};

const format = (target: Lang, key: TKey, vars?: Record<string, string | number>): string => {
  const template = DICTS[target][key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match: string, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
};

/** Translate `key` in the current UI language, filling `{name}` placeholders. */
export function t(key: TKey, vars?: Record<string, string | number>): string {
  return format(lang, key, vars);
}

/** Apply language to document-level metadata (title, lang attribute). */
export function applyDocumentLocale(): void {
  if (typeof document === "undefined") return;
  document.title = t("title");
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}
