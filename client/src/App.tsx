import { Landing } from "./Landing";
import { RoomPage } from "./RoomPage";
import { ShareTarget } from "./ShareTarget";

export default function App() {
  const match = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{6})\/?$/);
  if (window.location.pathname === "/share") return <ShareTarget />;
  return match ? <RoomPage code={match[1].toUpperCase()} /> : <Landing />;
}
