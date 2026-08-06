import assert from "node:assert/strict";
import test from "node:test";
import { getPlaylistId, isMixPlaylist } from "./youtube.js";
import { mapPlaylistItems } from "./search-service.js";

test("extracts playlist ids from common YouTube URL shapes", () => {
  assert.equal(getPlaylistId("https://www.youtube.com/playlist?list=PLabc123DEF456ghi789JKL"), "PLabc123DEF456ghi789JKL");
  assert.equal(getPlaylistId("https://music.youtube.com/playlist?list=OLAK5uy_kabcdefghijklmnopqrstuvwxyz012345"), "OLAK5uy_kabcdefghijklmnopqrstuvwxyz012345");
  assert.equal(getPlaylistId("https://www.youtube.com/watch?v=abcdefghijk&list=PLabc123DEF456ghi789JKL"), "PLabc123DEF456ghi789JKL");
  assert.equal(getPlaylistId("https://youtu.be/abcdefghijk?list=PLabc123DEF456ghi789JKL"), "PLabc123DEF456ghi789JKL");
});

test("rejects non-YouTube hosts and malformed list parameters", () => {
  assert.equal(getPlaylistId("https://example.com/playlist?list=PLabc123DEF456ghi789JKL"), null);
  assert.equal(getPlaylistId("https://www.youtube.com/watch?v=abcdefghijk"), null);
  assert.equal(getPlaylistId("https://www.youtube.com/playlist?list=bad!!chars"), null);
  assert.equal(getPlaylistId("not a url"), null);
});

test("detects per-viewer YouTube Mixes", () => {
  assert.equal(isMixPlaylist("RDabcdefghijk"), true);
  assert.equal(isMixPlaylist("PLabc123DEF456ghi789JKL"), false);
});

test("maps playlist items and filters deleted, private, and malformed videos", () => {
  const items = mapPlaylistItems({
    items: [
      { contentDetails: { videoId: "abcdefghijk" }, snippet: { title: "Song &amp; Dance", videoOwnerChannelTitle: "Artist &quot;A&quot;", thumbnails: { medium: { url: "https://i.ytimg.com/1.jpg" } } } },
      { contentDetails: { videoId: "lmnopqrstuv" }, snippet: { title: "Deleted video" } },
      { contentDetails: { videoId: "wxyzabcdefg" }, snippet: { title: "Private video" } },
      { contentDetails: { videoId: "short" }, snippet: { title: "Bad id" } },
      { snippet: { resourceId: { videoId: "hijklmnopqr" }, title: "Fallback id", channelTitle: "Channel B" } },
    ],
  });
  assert.deepEqual(items, [
    { providerId: "abcdefghijk", title: 'Song & Dance', artist: 'Artist "A"', thumbnail: "https://i.ytimg.com/1.jpg", url: "https://www.youtube.com/watch?v=abcdefghijk" },
    { providerId: "hijklmnopqr", title: "Fallback id", artist: "Channel B", thumbnail: null, url: "https://www.youtube.com/watch?v=hijklmnopqr" },
  ]);
});

test("handles empty or malformed playlist responses", () => {
  assert.deepEqual(mapPlaylistItems(undefined), []);
  assert.deepEqual(mapPlaylistItems({}), []);
  assert.deepEqual(mapPlaylistItems({ items: "nope" }), []);
});
