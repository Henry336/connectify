import assert from "node:assert/strict";
import test from "node:test";
import { fairQueueOrder } from "./room-service.js";

const track = (id: string, user: string, position: number, votes = 0, playedAt: Date | null = null, playNext = false) => ({
  id, addedBy: user, addedByUserId: user, position, votes, playedAt, playNext,
});

test("fair queue rotates contributors before repeating one person", () => {
  const tracks = [track("current", "a", 0), track("a-1", "a", 1), track("a-2", "a", 2), track("b-1", "b", 3), track("c-1", "c", 4)];
  assert.deepEqual(fairQueueOrder(tracks, "current"), ["b-1", "c-1", "a-1", "a-2"]);
});

test("votes prioritize a contributor's pick without defeating rotation", () => {
  const tracks = [track("current", "a", 0), track("b-low", "b", 1), track("b-high", "b", 2, 4), track("c-1", "c", 3)];
  assert.deepEqual(fairQueueOrder(tracks, "current"), ["b-high", "c-1", "b-low"]);
});

test("played tracks stay out of the fresh queue", () => {
  const tracks = [track("current", "a", 0), track("old", "b", 1, 8, new Date()), track("fresh", "c", 2)];
  assert.deepEqual(fairQueueOrder(tracks, "current"), ["fresh"]);
});

test("Play Next overrides contributor rotation exactly once", () => {
  const tracks = [track("current", "a", 0), track("fair-first", "b", 1), track("pinned", "a", 2, 0, null, true), track("later", "c", 3)];
  assert.deepEqual(fairQueueOrder(tracks, "current"), ["pinned", "fair-first", "later"]);
});

test("autoplay stays behind every human contribution", () => {
  const tracks = [
    track("current", "a", 0),
    { ...track("auto", "autopilot", 1), autoplayReason: "Inspired by room history" },
    track("b-1", "b", 2),
    track("c-1", "c", 3),
  ];
  assert.deepEqual(fairQueueOrder(tracks, "current"), ["b-1", "c-1", "auto"]);
});

test("directly selected contributor rotates behind the other listeners", () => {
  const tracks = [track("a-played", "a", 0, 0, new Date()), track("b-selected", "b", 1), track("b-2", "b", 2), track("a-next", "a", 3)];
  assert.deepEqual(fairQueueOrder(tracks, "b-selected"), ["a-next", "b-2"]);
});
