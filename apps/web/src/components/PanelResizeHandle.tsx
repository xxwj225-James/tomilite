import { useEffect, useRef } from 'react';

// ─── Panel resize handle — drag to resize the sibling panel ───
export function PanelResizeHandle({ panelOpen }: { panelOpen: boolean }) {
  const handleRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || !panelOpen) {
      // Clean up inline styles set by resize — allow CSS to take over
      if (panelRef.current) { panelRef.current.style.width = ''; panelRef.current.style.flex = ''; panelRef.current.style.transition = ''; }
      return;
    }
    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      const panel = handle.nextElementSibling as HTMLElement;
      if (!panel) return;
      panel.style.transition = 'none';
      panelRef.current = panel;
      const startX = e.clientX;
      const startWidth = panel.offsetWidth;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const newWidth = Math.max(300, Math.min(800, startWidth - dx));
        if (panelRef.current) {
          panelRef.current.style.width = newWidth + 'px';
          panelRef.current.style.flex = '0 0 ' + newWidth + 'px';
        }
      };
      const onUp = () => {
        if (panelRef.current) {
          panelRef.current.style.transition = '';
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    handle.addEventListener('mousedown', onDown);
    return () => handle.removeEventListener('mousedown', onDown);
  }, [panelOpen]);

  if (!panelOpen) return null;
  return (
    <div ref={handleRef}
      style={{
        width: 6, cursor: 'col-resize', flexShrink: 0,
        background: 'transparent', transition: 'background .1s',
        zIndex: 5, userSelect: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand)'; e.currentTarget.style.opacity = '0.6'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.opacity = '1'; }}
    />
  );
}
