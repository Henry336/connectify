import assert from "node:assert/strict";
import test from "node:test";
import { addTrackDenial, advanceAllowed, artistAllowed, endedPlaybackAllowed, joinRoomDenial, trackChangeAllowed } from "./room-policy.js";

test("locked rooms allow hosts and returning members but reject strangers", () => {
  assert.equal(joinRoomDenial({ isLocked: true, isReturning: false, isHost: false, isBanned: false }), "This room is locked to returning members.");
  assert.equal(joinRoomDenial({ isLocked: true, isReturning: true, isHost: false, isBanned: false }), null);
  assert.equal(joinRoomDenial({ isLocked: true, isReturning: false, isHost: true, isBanned: false }), null);
});

test("bans override returning membership and host claims", () => {
  assert.equal(joinRoomDenial({ isLocked: false, isReturning: true, isHost: true, isBanned: true }), "You were removed from this room.");
});

test("guest submission permissions and limits are enforced", () => {
  assert.equal(addTrackDenial({ isLocked: false, isReturning: true, isHost: false, isBanned: false, guestsCanAdd: false, pending: 0, limit: 5 }), "Only the host can add songs right now.");
  assert.equal(addTrackDenial({ isLocked: false, isReturning: true, isHost: false, isBanned: false, guestsCanAdd: true, pending: 5, limit: 5 }), "You can have up to 5 upcoming songs at once.");
  assert.equal(addTrackDenial({ isLocked: false, isReturning: false, isHost: true, isBanned: false, guestsCanAdd: false, pending: 20, limit: 1 }), null);
});

test("Discovery Night rejects repeat artists case-insensitively", () => {
  assert.equal(artistAllowed("discovery", ["The Daydreamers"], "the daydreamers"), false);
  assert.equal(artistAllowed("discovery", ["The Daydreamers"], "Another Artist"), true);
  assert.equal(artistAllowed("standard", ["The Daydreamers"], "The Daydreamers"), true);
});

test("One Take blocks manual changes but still advances when playback ends", () => {
  assert.equal(trackChangeAllowed("one_take", "current", "another"), false);
  assert.equal(trackChangeAllowed("one_take", "current", "current"), true);
  assert.equal(advanceAllowed("one_take", "manual"), false);
  assert.equal(advanceAllowed("one_take", "ended"), true);
});

test("only a current track near its authoritative end can advance the room", () => {
  const base = {
    currentTrackId: "current",
    expectedTrackId: "current",
    isPlaying: true,
    duration: 180,
    playbackPosition: 20,
    startedAt: new Date(100_000),
    now: 256_500,
  };
  assert.equal(endedPlaybackAllowed(base), true);
  assert.equal(endedPlaybackAllowed({ ...base, now: 200_000 }), false);
  assert.equal(endedPlaybackAllowed({ ...base, expectedTrackId: "stale" }), false);
  assert.equal(endedPlaybackAllowed({ ...base, isPlaying: false }), false);
  assert.equal(endedPlaybackAllowed({ ...base, duration: null }), false);
});
