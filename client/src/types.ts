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
  position: number;
  votes: number;
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
  revision: number;
  serverTime: string;
  tracks: Track[];
};

export type Person = { userId: string; name: string; avatar: string };
