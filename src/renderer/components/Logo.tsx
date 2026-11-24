export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="fg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--accent2))" />
          <stop offset="1" stopColor="rgb(var(--accent))" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#fg)" />
      <path d="M22 46V18h22v6H29v6h13v6H29v10z" fill="#fff" />
      <circle cx="47" cy="44" r="3.5" fill="#fff" opacity="0.85" />
    </svg>
  );
}
