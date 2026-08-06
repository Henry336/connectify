import assert from "node:assert/strict";
import test from "node:test";
import { pickRevivals, type RevivalCandidate } from "./room-service.js";

const now = Date.now();
const played = (id: string, artist: string, votes: number, minutesAgo: number, autoplayBlocked = false): RevivalCandidate =>
  ({ id, artist, votes, playedAt: new Date(now - minutesAgo * 60_000), autoplayBlocked });

test("revives crowd favorites first, then the oldest plays", () => {
  const candidates = [played("a", "A", 1, 10), played("b", "B", 5, 5), played("c", "C", 5, 20)];
  assert.deepEqual(pickRevivals(candidates, 2), ["c", "b"]);
});

test("never revives a blocked track even when it has the most votes", () => {
  const candidates = [played("bad", "A", 9, 30, true), played("ok", "B", 1, 5)];
  assert.deepEqual(pickRevivals(candidates, 2), ["ok"]);
});

test("never revives a track that was never played", () => {
  const candidates: RevivalCandidate[] = [{ id: "x", artist: "X", votes: 5, playedAt: null }, played("y", "Y", 1, 5)];
  assert.deepEqual(pickRevivals(candidates, 2), ["y"]);
});

test("spaces out artists already upcoming before allowing a repeat", () => {
  const candidates = [played("a1", "A", 5, 5), played("a2", "A", 4, 6), played("b1", "B", 1, 7)];
  assert.deepEqual(pickRevivals(candidates, 2, ["A"]), ["b1", "a1"]);
});

test("asks for nothing when the buffer is already full", () => {
  assert.deepEqual(pickRevivals([played("a", "A", 1, 5)], 0), []);
});
