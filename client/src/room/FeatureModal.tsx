import type { ReactNode } from "react";
import { X } from "lucide-react";

export default function FeatureModal({
  title,
  icon,
  onClose,
  children,
}: {
  title: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="feature-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <span>{icon}</span>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label={`Close ${title}`}><X /></button>
        </header>
        {children}
      </section>
    </div>
  );
}
