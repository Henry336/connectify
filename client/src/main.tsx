import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import { warmBackend } from "./api";
import { reportCoreWebVitals } from "./performance";
import "./styles.css";

const root = document.getElementById("root")!;
const application = <StrictMode><App /></StrictMode>;
if (root.hasChildNodes()) hydrateRoot(root, application);
else createRoot(root).render(application);

if (window.location.pathname === "/" || /^\/room\//.test(window.location.pathname)) void warmBackend().catch(() => undefined);

if ("serviceWorker" in navigator) window.addEventListener("load", () => { void navigator.serviceWorker.register("/sw.js"); });
window.addEventListener("load", reportCoreWebVitals, { once: true });
