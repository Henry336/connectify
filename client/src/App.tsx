import { lazy, Suspense, useState } from "react";
import { Landing } from "./Landing";
import { PublicPage, publicPaths } from "./PublicPage";
import { Brand } from "./Brand";
import { shouldShowWhatsNew } from "./whats-new";

const RoomPage = lazy(() => import("./RoomPage").then((module) => ({ default: module.RoomPage })));
const ShareTarget = lazy(() => import("./ShareTarget").then((module) => ({ default: module.ShareTarget })));
// Lazy like the routes above: keeps its stylesheet out of the prerender module graph,
// which runs in plain Node and cannot load CSS.
const WhatsNew = lazy(() => import("./WhatsNew").then((module) => ({ default: module.WhatsNew })));

export function AppRouter({ pathname }: { pathname: string }) {
  const normalized = pathname !== "/" ? pathname.replace(/\/$/, "") : pathname;
  const match = normalized.match(/^\/room\/([A-Za-z0-9]{6})$/);
  if (normalized === "/share") return <Suspense fallback={<PageLoader />}><ShareTarget /></Suspense>;
  if (match) return <Suspense fallback={<PageLoader />}><RoomPage code={match[1].toUpperCase()} /></Suspense>;
  if (normalized === "/") return <Landing />;
  if (publicPaths.includes(normalized)) return <PublicPage path={normalized} />;
  return <PublicPage path="/not-found" />;
}

function PageLoader() {
  return <main className="room-loading"><Brand /><div className="loading-record" /><p>Opening your room…</p></main>;
}

export default function App() {
  const pathname = window.location.pathname;
  // The share target is a hand-off screen someone lands on mid-action, so release notes
  // stay out of its way.
  const [showWhatsNew, setShowWhatsNew] = useState(() => pathname !== "/share" && shouldShowWhatsNew());
  return <>
    <AppRouter pathname={pathname} />
    {showWhatsNew && <Suspense fallback={null}><WhatsNew onDone={() => setShowWhatsNew(false)} /></Suspense>}
  </>;
}
