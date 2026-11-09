import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "./AuthGate";
import { applyDocumentLocale, getLang, subscribeLang } from "./i18n";

applyDocumentLocale();

/** Re-render the whole tree when the language changes. */
function Root() {
  useSyncExternalStore(subscribeLang, getLang);
  return <AuthGate />;
}

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");
createRoot(root).render(<Root />);
