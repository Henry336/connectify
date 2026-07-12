import assert from "node:assert/strict";
import test from "node:test";
import { adjacentTrackId } from "./room-service.js";

test("advances through the queue without wrapping", () => {
  const tracks = ["first", "second", "third"];
  assert.equal(adjacentTrackId(tracks, "first", 1), "second");
  assert.equal(adjacentTrackId(tracks, "second", 1), "third");
  assert.equal(adjacentTrackId(tracks, "third", 1), null);
});

test("moves backward and safely rejects stale track ids", () => {
  const tracks = ["first", "second"];
  assert.equal(adjacentTrackId(tracks, "second", -1), "first");
  assert.equal(adjacentTrackId(tracks, "first", -1), null);
  assert.equal(adjacentTrackId(tracks, "removed", 1), null);
});
