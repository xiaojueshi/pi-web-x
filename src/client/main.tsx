import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/AppShell";
import { PwaRegistration } from "@/components/PwaRegistration";
import { I18nProvider } from "@/hooks/useI18n";
import pkg from "../../package.json";
import "../../.build/globals.built.css";
import "../../components/ChatMinimap.css";
import "katex/dist/katex.min.css";

document.documentElement.dataset.appVersion = pkg.version;

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root mount point");

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <AppShell />
      <PwaRegistration />
    </I18nProvider>
  </StrictMode>,
);
