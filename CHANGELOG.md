# Changelog

What changed in Connectify, written for the people using it rather than the people
building it. Newest release first.

The in-app "What's new" overlay reads from `client/src/WhatsNew.tsx`. When you ship a
release worth announcing, add a section here, mirror it there, and bump
`CHANGELOG_VERSION` in `client/src/whats-new.ts` so the overlay shows once per device.

## 2026-08-06

A day spent on the parts of Connectify that were quietly annoying.

### Chat
- Fixed the message box rendering at a tiny, hard to read size on every device. It was a
  one character typo in a stylesheet selector.
- Enter sends a message, Shift+Enter starts a new line.
- Messages show the time they were sent, kept visually separate from the existing
  "jump to this moment in the song" timestamp.
- A shaky connection or a double tap can no longer post the same message twice.
- Messages show their delivery state: sending, sent, or failed with a one tap retry.
- Consecutive messages from the same person group together.

### Adding songs and playback
- Songs appear in the queue immediately instead of after the server confirms.
- The first song in an empty room starts loading right away.
- Search stays open after adding, so you can queue several songs without reopening it.
- The next track is loaded early, and playback gets a short grace period before any
  correction, which smooths out track changes in background tabs.
- Songs that cannot play, because they are blocked, deleted, or unavailable in your
  region, are skipped automatically instead of stalling the room.

### Smart Autoplay
- Autoplay is on by default in new and existing rooms, and leans toward fresh finds.
- A Familiar to Fresh slider in Host Controls sets how adventurous it gets.
- Paste a YouTube playlist link to import up to 50 songs at once.
- Autoplay picks explain themselves, for example "Because this room played JVKE".
- Songs can be marked "never play this again" so autoplay skips them.
- Autoplay and contributing songs to the shared Library are now separate switches.

### The Connectify Library
- The shared catalog grows on its own in the background, discovering music across
  genres without anyone adding it by hand.
- Seeding favours genres the catalog is thin on rather than ones already well covered.
- The same song uploaded as an "official video", a "lyrics video", and an "audio only"
  version is now recognised as one song instead of three separate entries.

### Search and queue
- Recent searches and recently added songs are remembered for quick re-adding.
- Search results mark songs that are already in the queue.
- The Queue and Chat tab choice is remembered per device.
- Keyboard shortcuts, with a help panel on `?`.
- The queue's drag and select controls were rendering with the browser's default grey
  button face. They now match the rest of the app.

### Offline and connection
- Rooms stay browsable without a connection, including queue, chat, and listeners.
  Playback still needs a connection, which is what keeps everyone in sync.
- The reconnecting notice no longer blocks the controls.
- On metered connections, Connectify skips extra thumbnails and background preloading.

### Behind the scenes
- The backend no longer sleeps between visits, so the first person to open Connectify
  after a quiet stretch does not wait roughly a minute for it to wake up.
- Screen reader announcements for track changes, and focus stays put after sending a
  message or adding a track.
