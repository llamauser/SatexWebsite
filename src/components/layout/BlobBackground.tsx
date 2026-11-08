/**
 * Decorative soft blurred color blobs from the SATEX promo look.
 * Pure CSS, no JS. Drift animation is disabled by the global prefers-reduced-motion rule.
 */
export function BlobBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute -start-24 -top-24 size-[28rem] rounded-full opacity-50 blur-[80px]"
        style={{ background: "var(--blob-blue)" }}
      />
      <div
        className="absolute -end-20 -top-16 size-[22rem] rounded-full opacity-50 blur-[80px]"
        style={{ background: "var(--blob-teal)" }}
      />
      <div
        className="absolute -end-24 bottom-0 size-[24rem] rounded-full opacity-50 blur-[80px]"
        style={{ background: "var(--blob-beige)" }}
      />
    </div>
  );
}
