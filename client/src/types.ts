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

export type PartyMode = "standard" | "pass_aux" | "blind_pick" | "one_take" | "discovery";
export type RoomTheme = "violet" | "sunset" | "ocean" | "mono";

export type RoomMember = {
  id: string;
  name: string;
  avatar: string;
  role: "host" | "guest";
  joinedAt: string;
  lastSeenAt: string;
};

export type Room = {
  id: string;
  code: string;
  name: string;
  currentTrackId: string | null;
  isPlaying: boolean;
  playbackPosition: number;
  startedAt: string | null;
  autopilotEnabled: boolean;
  partyMode: PartyMode;
  theme: RoomTheme;
  isLocked: boolean;
  guestsCanControl: boolean;
  guestsCanAdd: boolean;
  maxSongsPerUser: number;
  revision: number;
  createdAt: string;
  serverTime: string;
  tracks: Track[];
  queueOrder: string[];
  moments: Moment[];
  members: RoomMember[];
};

export type Person = { id: string; name: string; avatar: string; role: "host" | "guest" };
