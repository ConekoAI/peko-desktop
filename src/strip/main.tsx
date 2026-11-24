/**
 * The indicator strip's window (runtime ADR-123 D5): shown at the top of
 * the screen while a peko uses this computer. The native side makes the
 * window, keeps it out of screen captures and sends `computer-state`.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initTheme } from "../lib/theme";
import { initLanguage } from "../i18n";
import ComputerStrip from "../components/ComputerStrip";
import "@fontsource-variable/inter";
import "../styles/index.css";

// The window is transparent: only the strip's own rounded card shows.
document.documentElement.style.background = "transparent";
document.body.style.background = "transparent";
document.body.style.margin = "0";
(document.getElementById("root") as HTMLElement).style.height = "100vh";

void initLanguage().then(() => {
  initTheme();
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <ComputerStrip />
    </StrictMode>,
  );
});
