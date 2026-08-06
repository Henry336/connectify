import assert from "node:assert/strict";
import test from "node:test";
import { pickSeedTargets } from "./library-seed.js";

test("never-searched queries are prioritized over anything already run", () => {
  const candidates = [
    { query: "covered", lastSearchedAt: new Date("2026-01-01"), coverage: 0 },
    { query: "fresh", lastSearchedAt: null, coverage: 999 },
  ];
  assert.deepEqual(pickSeedTargets(candidates, 1), ["fresh"]);
});

test("among already-searched queries, the least-covered genre goes first", () => {
  const candidates = [
    { query: "well-covered", lastSearchedAt: new Date("2026-01-01"), coverage: 50 },
    { query: "thin", lastSearchedAt: new Date("2026-01-01"), coverage: 2 },
  ];
  assert.deepEqual(pickSeedTargets(candidates, 2), ["thin", "well-covered"]);
});

test("equal coverage breaks ties by staleness, oldest first", () => {
  const candidates = [
    { query: "recent", lastSearchedAt: new Date("2026-02-01"), coverage: 5 },
    { query: "stale", lastSearchedAt: new Date("2026-01-01"), coverage: 5 },
  ];
  assert.deepEqual(pickSeedTargets(candidates, 2), ["stale", "recent"]);
});

test("respects the daily budget", () => {
  const candidates = Array.from({ length: 10 }, (_, index) => ({ query: `q${index}`, lastSearchedAt: null, coverage: 0 }));
  assert.equal(pickSeedTargets(candidates, 3).length, 3);
});

test("queries with no remaining pages are skipped entirely", () => {
  const candidates = [
    { query: "mined-out", lastSearchedAt: null, coverage: 0, exhausted: true },
    { query: "still-going", lastSearchedAt: new Date("2026-01-01"), coverage: 40 },
  ];
  assert.deepEqual(pickSeedTargets(candidates, 5), ["still-going"]);
});

test("a fully exhausted catalog picks nothing rather than looping", () => {
  const candidates = [
    { query: "a", lastSearchedAt: null, coverage: 0, exhausted: true },
    { query: "b", lastSearchedAt: null, coverage: 0, exhausted: true },
  ];
  assert.deepEqual(pickSeedTargets(candidates, 5), []);
});

test("a zero or negative budget picks nothing", () => {
  const candidates = [{ query: "a", lastSearchedAt: null, coverage: 0 }];
  assert.deepEqual(pickSeedTargets(candidates, 0), []);
  assert.deepEqual(pickSeedTargets(candidates, -5), []);
});
