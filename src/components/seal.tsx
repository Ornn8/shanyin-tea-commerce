/** Seal-label stamp used as a brand and product detail mark. */
export function Seal({ glyph, className = '', label }: { glyph: string; className?: string; label?: string }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      className={`seal-stamp ${className}`}
      data-testid="seal"
    >
      {glyph}
    </span>
  );
}

export function SealSm({ glyph, className = '' }: { glyph: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`seal-stamp-sm ${className}`}>
      {glyph}
    </span>
  );
}
