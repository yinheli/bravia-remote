/**
 * Static assets for the web UI. All three files are imported as text so that
 * `bun build --compile` embeds them into the single-file executable; the same
 * imports also work when running from source.
 */

import appCss from "../../public/app.css" with { type: "text" };
import appJs from "../../public/app.js" with { type: "text" };
import indexHtmlRaw from "../../public/index.html" with { type: "text" };

// `with { type: "text" }` hands us the raw file contents at runtime, but the
// ambient `*.html` typing (HTMLBundle) targets Bun's full-stack HTML routes.
// Retype once at this boundary; the invariant is guaranteed by the import.
const indexHtml = indexHtmlRaw as unknown as string;

export type StaticAsset = { body: string; type: string };

const html: StaticAsset = { body: indexHtml, type: "text/html; charset=utf-8" };

export const ASSETS: ReadonlyMap<string, StaticAsset> = new Map([
  ["/", html],
  ["/index.html", html],
  ["/app.css", { body: appCss, type: "text/css; charset=utf-8" }],
  ["/app.js", { body: appJs, type: "text/javascript; charset=utf-8" }],
]);
