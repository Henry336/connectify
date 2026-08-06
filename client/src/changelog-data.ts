// Single source of truth for release notes, shared by the first-run "What's new"
// overlay and the on-demand changelog reader accessible from the landing page.
//
// Keep at most 3 entries, newest first. When a release ships, add it to the front and
// drop the oldest one if the array would grow past 3 -- the on-demand reader only ever
// shows "the 3 most recent," so anything older than that has no reason to stay here.
// The full history lives permanently in CHANGELOG.md at the repo root; this array is
// deliberately just a rolling window, not the archive.

export type ChangelogItem = { body: string; fixed?: boolean };
export type ChangelogSection = { eyebrow: string; heading: string; items: ChangelogItem[] };
export type Release = { version: string; dateLabel: string; lead: string; sections: ChangelogSection[] };

export const RELEASES: Release[] = [
  {
    version: "2026.08.06",
    dateLabel: "6 August 2026",
    lead: "We spent the day on the parts of Connectify that were quietly annoying: chat you had to squint at, songs that took a beat too long to show up, and rooms that went silent once the queue ran dry. Here is everything that is different.",
    sections: [
      {
        eyebrow: "Chat",
        heading: "Actually readable now",
        items: [
          { body: "The message box was rendering at a tiny, squint-at-your-phone size. That was a one-character typo in our stylesheet, and it is fixed.", fixed: true },
          { body: "Enter sends your message. Shift+Enter starts a new line, the way you would expect." },
          { body: "Messages show the time you sent them, kept separate from the \"jump to this moment in the song\" timestamp so the two never get confused." },
          { body: "A shaky connection or an impatient double tap can no longer post the same message twice." },
          { body: "Every message shows where it is up to: sending, sent, or failed with a one-tap retry." },
        ],
      },
      {
        eyebrow: "Adding songs and playback",
        heading: "Less waiting around",
        items: [
          { body: "Songs land in the queue the moment you add them. No spinner, no waiting on us." },
          { body: "The first song in an empty room starts loading right away instead of after the server catches up." },
          { body: "Search stays open after you add something, so queuing up five songs in a row does not mean reopening it five times." },
          { body: "Track changes are smoother, especially when Connectify is in a background tab. We load the next song early and give playback a moment to settle instead of jumping in to correct it too eagerly." },
          { body: "A song that cannot play, because it is blocked, deleted, or unavailable where you are, now gets skipped automatically instead of quietly stalling the room.", fixed: true },
        ],
      },
      {
        eyebrow: "Smart Autoplay",
        heading: "Keeps the room going on its own",
        items: [
          { body: "Autoplay is on by default in every room now, and it leans toward finding you something new rather than replaying what you just heard." },
          { body: "There is a Familiar to Fresh slider in Host Controls. Slide it down to stick with what the room loves, or up to let it wander." },
          { body: "Paste a YouTube playlist link and Connectify pulls in up to 50 songs at once." },
          { body: "Autoplay picks tell you why they showed up, like \"Because this room played JVKE.\"" },
          { body: "Heard enough of a song forever? Mark it \"never play this again\" and autoplay will leave it alone." },
          { body: "Autoplay and sharing your room's songs to the Library are two separate switches now, so you can have either one without the other." },
        ],
      },
      {
        eyebrow: "The Connectify Library",
        heading: "Grows on its own now",
        items: [
          { body: "The shared catalog every room can search now fills itself in quietly in the background, finding music across genres without anyone adding it by hand." },
          { body: "It leans toward genres the catalog is thin on instead of piling more onto whatever is already well covered." },
          { body: "The same song uploaded three times as an \"official video,\" a \"lyrics video,\" and an \"audio only\" version used to show up as three separate results. Connectify recognises them as one song now.", fixed: true },
        ],
      },
      {
        eyebrow: "Search and queue",
        heading: "Small things, every single day",
        items: [
          { body: "Your recent searches and recently added songs are remembered, so re-adding a favourite takes one tap." },
          { body: "Search results now show you what is already sitting in the queue." },
          { body: "Connectify remembers whether you had Queue or Chat open, per device." },
          { body: "There are keyboard shortcuts now. Press ? in any room to see them. Space plays and pauses, N skips, and a few more." },
          { body: "The drag and select buttons in the queue looked like grey placeholder boxes. They match the rest of the app now.", fixed: true },
        ],
      },
      {
        eyebrow: "When you lose signal",
        heading: "The room does not just vanish",
        items: [
          { body: "If your connection drops, you can still browse the room: the queue, the chat, and who is listening." },
          { body: "Playback still needs a live connection. That is on purpose, it is what keeps everyone hearing the same thing at the same time." },
          { body: "On a slow or metered connection, Connectify stops loading extra thumbnails and pre-buffering in the background." },
        ],
      },
      {
        eyebrow: "Behind the scenes",
        heading: "Quicker to open",
        items: [
          { body: "Connectify used to nod off between visits, so whoever opened it first after a quiet spell waited about a minute for it to wake up. It stays awake now.", fixed: true },
          { body: "General reliability work across chat, search, and the queue." },
        ],
      },
    ],
  },
];
