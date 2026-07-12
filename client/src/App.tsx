import { Landing } from "./Landing";
import { RoomPage } from "./RoomPage";

export default function App() {
  const match = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{6})\/?$/);
  return match ? <RoomPage code={match[1].toUpperCase()} /> : <Landing />;
}
