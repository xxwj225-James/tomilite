// Robot face avatar component
// White rounded eyes with blink animation + SVG curved smile
export function RobotFace({ size = 28 }: { size?: number }) {
  const eyeW = size * 0.16;
  const eyeH = size * 0.24;
  const eyeGap = size * 0.35;
  return (
    <span className="relative flex flex-col items-center justify-center" style={{ width: size * 0.85, height: size * 0.85, gap: `${size * 0.08}px` }}>
      {/* Eyes row */}
      <span className="flex items-center">
        <span className="blink-eye" style={{ width: eyeW, height: eyeH, borderRadius: '50%', background: '#fff', display: 'inline-block', marginRight: `${eyeGap * 0.5}px` }} />
        <span className="blink-eye" style={{ width: eyeW, height: eyeH, borderRadius: '50%', background: '#fff', display: 'inline-block', marginLeft: `${eyeGap * 0.5}px` }} />
      </span>
      {/* Smile arc — SVG quadratic curve */}
      <svg width={size * 0.45} height={size * 0.16} viewBox="0 0 20 8" style={{ display: 'block', margin: '0 auto' }}>
        <path d="M2 2 Q10 12 18 2" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="4.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
