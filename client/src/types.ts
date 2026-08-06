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
  removedAt: string | null;
  playNext: boolean;
  pending?: boolean;
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

export type ChatMessage = {
  id: string;
  roomId: string;
  trackId: string | null;
  userId: string;
  name: string;
  avatar: string;
  body: string;
  position: number | null;
  spoiler: boolean;
  replyToId: string | null;
  replyTo: { id: string; name: string; body: string; spoiler: boolean } | null;
  createdAt: string;
  operationId?: string;
  status?: "sending" | "sent" | "failed";
};

export type PartyMode = "standard" | "pass_aux" | "blind_pick" | "one_take" | "discovery" | "watch_party";
export type RoomTheme = "violet" | "sunset" | "ocean" | "mono";

export type RoomMember = {
  id: string;
  userId: string;
  name: string;
  avatar: string;
  role: "host" | "guest";
  joinedAt: string;
  lastSeenAt: string;
};

export type RoomActivity = {
  id: string;
  roomId: string;
  actorId: string;
  actorName: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
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
  autoplayMinBuffer: number;
  partyMode: PartyMode;
  theme: RoomTheme;
  isLocked: boolean;
  guestsCanControl: boolean;
  guestsCanAdd: boolean;
  maxSongsPerUser: number;
  maxParticipants: number;
  chatSlowMode: 0 | 2 | 5 | 10 | 30;
  discoverable: boolean;
  revision: number;
  createdAt: string;
  serverTime: string;
  receivedAt?: number;
  tracks: Track[];
  queueOrder: string[];
  moments: Moment[];
  members: RoomMember[];
  memberCount: number;
  messages: ChatMessage[];
  hasMoreMessages: boolean;
};

export type Person = { id: string; userId: string; name: string; avatar: string; role: "host" | "guest" };

export type SearchItem = {
  providerId: string;
  title: string;
  artist: string;
  thumbnail: string | null;
  url: string;
  duration: number | null;
  source: "connectify" | "youtube";
};
