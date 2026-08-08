import assert from "node:assert/strict";
import test from "node:test";
import { AUTOPLAY_IDLE_MS, autoplayRefillNeed, discoveryQueries, pickDiscovery, splitAutoplay, topArtists } from "./discovery.js";

test("top artists rank by appearances, votes, and completed plays", () => {
  const artists = topArtists([
    { artist: "JVKE", votes: 3, playedAt: new Date() },
    { artist: "JVKE", votes: 0, playedAt: null },
    { artist: "Mitski", votes: 1, playedAt: new Date() },
    { artist: "Beach House", votes: 0, playedAt: null },
  ]);
  assert.deepEqual(artists, ["JVKE", "Mitski", "Beach House"]);
});

test("top artists ignore the generic YouTube fallback artist", () => {
  assert.deepEqual(topArtists([{ artist: "YouTube", votes: 9, playedAt: new Date() }, { artist: "Ivy", votes: 0 }]), ["Ivy"]);
});

test("discovery queries blend the room's strongest artists instead of searching one catalogue", () => {
  assert.deepEqual(discoveryQueries([
    { artist: "JVKE", votes: 3 },
    { artist: "Mitski", votes: 2 },
    { artist: "Beach House", votes: 1 },
  ], 3), [
    "JVKE Mitski similar music",
    "Mitski Beach House similar music",
    "Beach House JVKE similar music",
  ]);
});

test("autoplay waits for a small queue and a quiet contribution window", () => {
  const now = Date.now();
  assert.equal(autoplayRefillNeed({ upcomingCount: 3, targetBuffer: 4, lastHumanAddedAt: new Date(now - AUTOPLAY_IDLE_MS - 1), now }), 0);
  assert.equal(autoplayRefillNeed({ upcomingCount: 2, targetBuffer: 4, lastHumanAddedAt: new Date(now - 1_000), now }), 0);
  assert.equal(autoplayRefillNeed({ upcomingCount: 2, targetBuffer: 4, lastHumanAddedAt: new Date(now - AUTOPLAY_IDLE_MS - 1), now }), 2);
});

test("familiar-fresh split follows the freshness setting", () => {
  assert.deepEqual(splitAutoplay(4, 50, true), { fresh: 2, revive: 2 });
  assert.deepEqual(splitAutoplay(4, 0, true), { fresh: 0, revive: 4 });
  assert.deepEqual(splitAutoplay(4, 100, true), { fresh: 4, revive: 0 });
});

test("everything stays familiar when no discovery pool is ready", () => {
  assert.deepEqual(splitAutoplay(4, 80, false), { fresh: 0, revive: 4 });
});

test("split clamps out-of-range freshness and empty need", () => {
  assert.deepEqual(splitAutoplay(0, 50, true), { fresh: 0, revive: 0 });
  assert.deepEqual(splitAutoplay(2, 400, true), { fresh: 2, revive: 0 });
});

test("discovery never re-suggests songs the room already has", () => {
  const pool = [{ providerId: "aaaaaaaaaaa", artist: "A" }, { providerId: "bbbbbbbbbbb", artist: "B" }];
  assert.deepEqual(pickDiscovery(pool, new Set(["aaaaaaaaaaa"]), 2), [{ providerId: "bbbbbbbbbbb", artist: "B" }]);
});

test("discovery spaces out artists already upcoming before repeating", () => {
  const pool = [{ providerId: "a1aaaaaaaaa", artist: "A" }, { providerId: "b1bbbbbbbbb", artist: "B" }, { providerId: "a2aaaaaaaaa", artist: "A" }];
  const picked = pickDiscovery(pool, new Set(), 2, ["A"]);
  assert.deepEqual(picked.map((item) => item.providerId), ["b1bbbbbbbbb", "a1aaaaaaaaa"]);
});

test("discovery deduplicates providerIds inside the pool", () => {
  const pool = [{ providerId: "ccccccccccc", artist: "C" }, { providerId: "ccccccccccc", artist: "C" }];
  assert.equal(pickDiscovery(pool, new Set(), 2).length, 1);
});
