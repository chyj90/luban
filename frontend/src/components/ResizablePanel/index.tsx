import { useState, useCallback, useRef } from 'react';

interface ResizablePanelProps {
  children: React.ReactNode;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  side: 'left' | 'right';
}

export function ResizablePanel({ children, defaultWidth, minWidth, maxWidth, side }: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = side === 'left' ? e.clientX : window.innerWidth - e.clientX;
      setWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [side, minWidth, maxWidth]);

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: side === 'right' ? 'row' : 'row' }}>
      {side === 'right' && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            width: 4,
            cursor: 'col-resize',
            background: 'transparent',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#e2e8f0')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        />
      )}
      <div style={{ width, overflow: 'hidden', borderRight: side === 'left' ? '1px solid #e2e8f0' : 'none', borderLeft: side === 'right' ? '1px solid #e2e8f0' : 'none' }}>
        {children}
      </div>
      {side === 'left' && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            width: 4,
            cursor: 'col-resize',
            background: 'transparent',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#e2e8f0')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        />
      )}
    </div>
  );
}