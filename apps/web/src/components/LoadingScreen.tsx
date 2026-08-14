// ═══ Loading splash — shown while sessions load (avoids black flash) ═══
export function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', flexDirection: 'column', fontFamily: 'sans-serif' }}>
      <svg width="60" height="60" viewBox="0 0 20 20" style={{ fill: '#4338CA', animation: 'pulse 2s ease-in-out infinite' }}>
        <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
      </svg>
      <style>{'@keyframes pulse{0%,100%{opacity:.4;transform:scale(.9)}50%{opacity:1;transform:scale(1.1)}}'}</style>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--muted)', marginTop: 16 }}>TomiLite</div>
      <div style={{ width: 200, height: 3, background: 'var(--surface2)', borderRadius: 2, marginTop: 12, overflow: 'hidden' }}>
        <div style={{ width: '30%', height: '100%', background: 'linear-gradient(90deg,#4338CA,#6366f1)', borderRadius: 2, animation: 'barSlide 1.5s ease-in-out infinite' }} />
      </div>
      <style>{'@keyframes barSlide{0%{transform:translateX(-30%)}100%{transform:translateX(330%)}}'}</style>
    </div>
  );
}
