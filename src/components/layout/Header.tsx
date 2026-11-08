/** Placeholder header. Navigation, language switcher and account menu arrive in P1-02 / P1-05 / P1-06. */
export function Header() {
  return (
    <header className="border-b border-border/60 bg-surface/70 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center px-4 sm:px-6 lg:px-8">
        <span className="font-display text-lg font-bold tracking-tight">
          SA<span className="text-primary">TEX</span>
          <span className="ms-2 text-xs font-medium uppercase tracking-[0.2em] text-text-muted">
            Commerce
          </span>
        </span>
      </div>
    </header>
  );
}
