/** Decorative isometric sketch of the two-floor showroom (the interactive 3D version arrives in P1-16). */
export function ShowroomIllustration() {
  const floor = (dy: number, fill: string, label: string) => (
    <g transform={`translate(0 ${dy})`} aria-label={label}>
      <polygon points="200,20 380,110 200,200 20,110" fill={fill} stroke="var(--border)" strokeWidth="2" />
      <polygon points="20,110 200,200 200,222 20,132" fill="var(--surface-muted)" stroke="var(--border)" strokeWidth="2" />
      <polygon points="380,110 200,200 200,222 380,132" fill="var(--border)" stroke="var(--border)" strokeWidth="2" />
    </g>
  );
  const rack = (x: number, y: number, color: string) => (
    <g transform={`translate(${x} ${y})`}>
      <polygon points="0,10 34,27 68,10 34,-7" fill={color} opacity="0.9" />
      <polygon points="0,10 34,27 34,41 0,24" fill={color} opacity="0.65" />
      <polygon points="68,10 34,27 34,41 68,24" fill={color} opacity="0.45" />
    </g>
  );
  return (
    <svg viewBox="0 0 400 330" role="img" aria-hidden="true" className="h-auto w-full">
      {floor(100, "#EEF3F7", "ground floor")}
      {rack(110, 170, "#C9B497")}
      {rack(190, 150, "#8FB3DE")}
      {rack(250, 195, "#E49A7C")}
      {rack(150, 210, "#2B3A67")}
      <g transform="translate(0 -20)">
        {floor(0, "#FFFFFF", "upper floor")}
        <polygon points="120,100 200,140 280,100 200,60" fill="#8FB3DE" opacity="0.5" />
        <polygon points="170,95 200,110 230,95 200,80" fill="#5E9AAE" opacity="0.8" />
      </g>
      <circle cx="200" cy="64" r="7" fill="var(--primary)" />
      <circle cx="200" cy="64" r="14" fill="none" stroke="var(--primary)" strokeOpacity="0.4" />
    </svg>
  );
}
