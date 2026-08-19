interface PlaceholderTeaProps {
  /**
   * Language-neutral seed used to derive the illustration variant. Pass a
   * product slug (stable illustration) or a product+variant key (distinct
   * media per variant, ADR-0006).
   */
  slug: string;
  className?: string;
  /** Accessible name; must be localized by callers (fallback keeps parity). */
  alt?: string;
}

const PALETTES = [
  {
    background: 'linear-gradient(135deg, #e4ede6 0%, #c9dbcf 100%)',
    ring: '#a3c2ad',
    leaf: '#31644e',
    leafLight: '#437d63',
    steam: '#7aa386',
  },
  {
    background: 'linear-gradient(135deg, #f0f6f2 0%, #dcebe2 100%)',
    ring: '#bcd7c7',
    leaf: '#214134',
    leafLight: '#31644e',
    steam: '#92bba5',
  },
  {
    background: 'linear-gradient(135deg, #f3f7f4 0%, #e4ede6 100%)',
    ring: '#c9dbcf',
    leaf: '#275140',
    leafLight: '#437d63',
    steam: '#a3c2ad',
  },
];

function pickPalette(slug: string) {
  const sum = [...slug].reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return PALETTES[sum % PALETTES.length];
}

/**
 * Original, hand-drawn placeholder illustration (tea leaf + steam).
 * Deliberately not a marketplace asset; replaced by merchant photography
 * before production. See PRODUCT.md.
 */
export function PlaceholderTea({ slug, className, alt }: PlaceholderTeaProps) {
  const palette = pickPalette(slug);
  return (
    <svg
      viewBox="0 0 400 300"
      className={className}
      role="img"
      aria-label={
        alt ?? 'Placeholder tea illustration — replace with merchant photography'
      }
    >
      <defs>
        <linearGradient id={`bg-${slug}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={palette.background} />
        </linearGradient>
      </defs>
      <rect width="400" height="300" fill={`url(#bg-${slug})`} />
      <circle cx="200" cy="150" r="86" fill="none" stroke={palette.ring} strokeWidth="1.5" />
      {/* steam */}
      <g stroke={palette.steam} strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.8">
        <path d="M172 74c-6 8-6 16 0 24" />
        <path d="M200 62c-8 10-8 20 0 30" />
        <path d="M228 74c-6 8-6 16 0 24" />
      </g>
      {/* stylized tea leaf pair */}
      <g>
        <path
          d="M200 188c-34-10-52-44-40-74 30-8 64 12 72 44-2 14-14 26-32 30Z"
          fill={palette.leaf}
        />
        <path
          d="M200 188c34-10 52-44 40-74-30-8-64 12-72 44 2 14 14 26 32 30Z"
          fill={palette.leafLight}
        />
        <path d="M200 120v58" stroke={palette.ring} strokeWidth="1.5" />
        <path d="M176 140c8 2 16 2 24 0" stroke={palette.ring} strokeWidth="1.2" fill="none" />
        <path d="M224 140c-8 2-16 2-24 0" stroke={palette.ring} strokeWidth="1.2" fill="none" />
      </g>
    </svg>
  );
}
