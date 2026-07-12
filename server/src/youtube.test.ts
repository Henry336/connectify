import assert from "node:assert/strict";
import test from "node:test";
import { getYouTubeId } from "./youtube.js";

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
