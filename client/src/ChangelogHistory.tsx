import { History } from "lucide-react";
import FeatureModal from "./room/FeatureModal";
import { RELEASES } from "./changelog-data";
import "./whats-new.css";

// The 3 most recent releases, freely reopenable and dismissible -- unlike the first-run
// WhatsNew overlay, there is no scroll-to-unlock gate here. Someone reaching for this
// already knows what they are looking at and should be able to close it any normal way
// (Escape, backdrop click, the X), which FeatureModal already handles.
export function ChangelogHistory({ onClose }: { onClose: () => void }) {
  return (
    <FeatureModal title="What's new" icon={<History />} onClose={onClose} variant="wide">
      <div className="changelog-history">
        {RELEASES.map((release, index) => (
          <section key={release.version} className={`whats-new-entry changelog-release ${index === 0 ? "is-latest" : ""}`}>
            <p className="whats-new-eyebrow">{release.dateLabel}{index === 0 && <span className="changelog-latest-tag">Latest</span>}</p>
            <p className="whats-new-lead changelog-release-lead">{release.lead}</p>
            {release.sections.map((section) => (
              <div key={section.eyebrow} className="changelog-section">
                <h3>{section.heading}</h3>
                <ul>
                  {section.items.map((item) => (
                    <li key={item.body} className={item.fixed ? "is-fix" : ""}>
                      {item.fixed && <span className="whats-new-fix-tag">Fixed</span>}
                      {item.body}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </FeatureModal>
  );
}
