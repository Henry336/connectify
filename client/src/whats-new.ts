// Bump this when a release deserves its own "What's new" pass. The value is what gets
// stored per device, so an older stored version is what brings the overlay back.
export const CHANGELOG_VERSION = "2026.08.06";

const SEEN_KEY = "connectify.changelogSeen";

// Captured at module load, before any component can call getIdentity() and create one,
// so a genuinely first-time visitor never gets release notes for an app they have not
// used yet. They get the version quietly marked as seen instead.
const isReturningVisitor = typeof window !== "undefined" && Boolean(localStorage.getItem("connectify.identity"));

export function shouldShowWhatsNew() {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(SEEN_KEY) === CHANGELOG_VERSION) return false;
    if (!isReturningVisitor) {
      markWhatsNewSeen();
      return false;
    }
    return true;
  } catch {
    // Storage can be unavailable in hardened private-browsing modes. Never block the app.
    return false;
  }
}

export function markWhatsNewSeen() {
  try { localStorage.setItem(SEEN_KEY, CHANGELOG_VERSION); }
  catch { /* Dismissal is best-effort. */ }
}
