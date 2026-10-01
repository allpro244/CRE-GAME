import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./ui/craft.css"; // after index.css on purpose — these rules settle ties
// The design system loads last: fonts, tokens, components, the shell, the rooms.
import "./ui/system/fonts.css";
import "./ui/system/tokens.css";
import "./ui/system/components.css";
import "./ui/system/shell.css";
import { applyTheme } from "./ui/theme";

applyTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
