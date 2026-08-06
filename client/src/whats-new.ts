import { RELEASES } from "./changelog-data";

// Adding a release to the front of RELEASES in changelog-data.ts is what brings this
// overlay back -- CHANGELOG_VERSION just mirrors whatever the newest entry there is,
// so there is one place to update, not two.
export const CHANGELOG_VERSION = RELEASES[0].version;

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
