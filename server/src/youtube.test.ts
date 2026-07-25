import assert from "node:assert/strict";
import test from "node:test";
import { getYouTubeId, resolveTrack } from "./youtube.js";

test("extracts ids from common YouTube URL formats", () => {
  assert.equal(getYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(getYouTubeId("https://youtu.be/dQw4w9WgXcQ?t=2"), "dQw4w9WgXcQ");
  assert.equal(getYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(getYouTubeId("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("rejects unsupported and malformed URLs", () => {
  assert.equal(getYouTubeId("https://spotify.com/track/abc"), null);
  assert.equal(getYouTubeId("not a url"), null);
  assert.equal(getYouTubeId("https://youtube.com/watch?v=too-short"), null);
});

test("reuses trusted search metadata without another lookup", async () => {
  const resolved = await resolveTrack("https://youtu.be/dQw4w9WgXcQ", {
    providerId: "dQw4w9WgXcQ",
    title: "Search result title",
    artist: "Search result channel",
    thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    duration: null,
  });
  assert.equal(resolved.providerId, "dQw4w9WgXcQ");
  assert.equal(resolved.title, "Search result title");
  assert.equal(resolved.artist, "Search result channel");
});
