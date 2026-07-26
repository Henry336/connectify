import { ArrowLeft, Check, Radio, Share2 } from "lucide-react";
import { Brand } from "./Brand";
import { useMemo, useState } from "react";
import { api } from "./api";
import { getHostToken, getIdentity, getRecentRooms } from "./identity";

const extractYouTubeUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const combined = [params.get("url"), params.get("text"), params.get("title")].filter(Boolean).join(" ");
  const match = combined.match(/https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/[^\s]+|youtu\.be\/[^\s]+)/i);
  return match?.[0] || "";
};

export function ShareTarget() {
  const identity = getIdentity();
  const rooms = getRecentRooms();
  const url = useMemo(extractYouTubeUrl, []);
  const [addingTo, setAddingTo] = useState("");
  const [error, setError] = useState("");

  const add = async (code: string) => {
    setAddingTo(code); setError("");
    try {
      await api(`/api/rooms/${code}/tracks`, { method: "POST", body: JSON.stringify({ url, addedBy: identity.name, userId: identity.userId, hostToken: getHostToken(code), placement: "last", operationId: crypto.randomUUID() }) });
      window.location.href = `/room/${code}`;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add that video."); setAddingTo(""); }
  };

  return <main className="share-target"><Brand /><section><div className="share-icon"><Share2 /></div><span>SHARED FROM YOUTUBE</span><h1>Add to Connectify</h1>{url ? <p>Choose one of your recent rooms. The original URL remains the source, so this uses no search quota.</p> : <p>Connectify could not find a YouTube URL in that share.</p>}{error && <div className="form-error">{error}</div>}<div className="share-room-list">{url && rooms.map((room) => <button key={room.code} disabled={Boolean(addingTo)} onClick={() => add(room.code)}><i><Radio /></i><span><strong>{room.name}</strong><small>{room.code}</small></span>{addingTo === room.code ? <em>Adding…</em> : <Check />}</button>)}</div>{!rooms.length && <p className="share-empty">Visit a Connectify room first so it appears here.</p>}<a className="share-back" href="/"><ArrowLeft />Back to Connectify</a></section></main>;
}
