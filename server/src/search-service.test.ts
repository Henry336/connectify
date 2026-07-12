import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSearchQuery, uniqueSearchItems, type SearchItem } from "./search-service.js";

const item = (providerId: string): SearchItem => ({ providerId, title: providerId, artist: "Artist", thumbnail: null, url: `https://youtube.com/watch?v=${providerId}`, duration: null, source: "connectify" });

test("search queries normalize whitespace and case for cache reuse", () => {
  assert.equal(normalizeSearchQuery("  Daft   PUNK  "), "daft punk");
});

test("library results deduplicate videos while preserving priority", () => {
  assert.deepEqual(uniqueSearchItems([item("room"), item("duplicate"), item("duplicate"), item("global")]).map((entry) => entry.providerId), ["room", "duplicate", "global"]);
});
