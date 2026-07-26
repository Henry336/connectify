type BrandProps = {
  className?: string;
  compact?: boolean;
};

type ConnectifyMarkProps = {
  className?: string;
};

export function ConnectifyMark({ className = "" }: ConnectifyMarkProps) {
  return <svg
    className={`brand-mark ${className}`.trim()}
    viewBox="0 0 40 40"
    role="img"
    aria-label="Connectify"
  >
    <rect className="brand-mark-field" x="1" y="1" width="38" height="38" rx="12" />
    <path className="brand-mark-sheen" d="M7 12.2C12.8 5.9 24.8 4.6 33.3 9.5V19C26.7 14.5 16.3 14.8 7 20.5Z" />
    <path className="brand-mark-wave brand-mark-wave-outer" d="M13.7 10.8C7.7 15.8 7.7 24.2 13.7 29.2M26.3 10.8C32.3 15.8 32.3 24.2 26.3 29.2" />
    <path className="brand-mark-wave brand-mark-wave-inner" d="M17.4 15C14.2 17.7 14.2 22.3 17.4 25M22.6 15C25.8 17.7 25.8 22.3 22.6 25" />
    <circle className="brand-mark-core-halo" cx="20" cy="20" r="4.2" />
    <circle className="brand-mark-core" cx="20" cy="20" r="2.45" />
  </svg>;
}

export function Brand({ className = "", compact = false }: BrandProps) {
  return <a
    className={`brand ${compact ? "brand-compact" : ""} ${className}`.trim()}
    href="/"
    aria-label="Connectify home"
  >
    <ConnectifyMark />
    <span className="brand-wordmark" aria-hidden="true">
      connect<span className="brand-wordmark-signal">ı</span>fy
    </span>
  </a>;
}
