export type Track = {
  id: string;
  url: string;
  provider: "youtube";
  providerId: string;
  title: string;
  artist: string;
  thumbnail: string | null;
  duration: number | null;
  addedBy: string;
  addedByUserId: string | null;
  position: number;
  votes: number;
  playedAt: string | null;
};

export type Moment = {
  id: string;
  roomId: string;
  trackId: string;
  userId: string;
  name: string;
  avatar: string;
  emoji: string;
  position: number;
  createdAt: string;
};

export type Room = {
  id: string;
  code: string;
  name: string;
  createdBy: string;
  currentTrackId: string | null;
  isPlaying: boolean;
  playbackPosition: number;
  startedAt: string | null;
  autopilotEnabled: boolean;
  revision: number;
  serverTime: string;
  tracks: Track[];
  queueOrder: string[];
  moments: Moment[];
};

export type Person = { userId: string; name: string; avatar: string };
