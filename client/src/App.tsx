import { lazy, Suspense } from "react";
import { Landing } from "./Landing";
import { PublicPage, publicPaths } from "./PublicPage";

const RoomPage = lazy(() => import("./RoomPage").then((module) => ({ default: module.RoomPage })));
const ShareTarget = lazy(() => import("./ShareTarget").then((module) => ({ default: module.ShareTarget })));

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
  return <main className="room-loading"><a className="brand" href="/">connectify</a><div className="loading-record" /><p>Opening your room…</p></main>;
}

export default function App() { return <AppRouter pathname={window.location.pathname} />; }
