import { useCallback, useEffect, useRef, useState } from 'react';

export interface SignatureLabels { draw: string; type: string; clear: string; hint: string; typePlaceholder: string; canvasLabel: string }

/**
 * Signature input: draw (mouse / touch / pen) or type (keyboard-accessible).
 * Emits a transparent PNG data URL, or null while empty.
 */
export function SignaturePad({ onChange, labels, defaultName = '', rtl = false }: {
  onChange: (png: string | null) => void; labels: SignatureLabels; defaultName?: string; rtl?: boolean;
}) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typed, setTyped] = useState(defaultName);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const dirty = useRef(false);

  const ctx = () => canvas.current?.getContext('2d') ?? null;

  const setup = useCallback(() => {
    const c = canvas.current; if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 2.4; g.strokeStyle = '#111827';
    dirty.current = false;
  }, []);

  const renderTyped = useCallback((name: string) => {
    const c = canvas.current; const g = ctx(); if (!c || !g) return;
    const r = c.getBoundingClientRect();
    g.clearRect(0, 0, r.width, r.height);
    if (!name.trim()) { onChange(null); return; }
    const family = rtl ? "'Vazirmatn Variable', Vazirmatn, Tahoma, sans-serif" : "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive";
    let size = 40;
    g.font = `${rtl ? 600 : 400} ${size}px ${family}`;
    while (g.measureText(name).width > r.width - 32 && size > 16) { size -= 2; g.font = `${rtl ? 600 : 400} ${size}px ${family}`; }
    g.fillStyle = '#111827'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(name, r.width / 2, r.height / 2);
    onChange(c.toDataURL('image/png'));
  }, [onChange, rtl]);

  useEffect(() => {
    setup();
    if (mode === 'type') renderTyped(typed); else onChange(null);
    const onResize = () => { setup(); if (mode === 'type') renderTyped(typed); else onChange(null); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    if (mode !== 'draw') return;
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true; last.current = pos(e);
    const g = ctx()!; const p = last.current;
    g.beginPath(); g.arc(p.x, p.y, 1.1, 0, Math.PI * 2); g.fillStyle = '#111827'; g.fill();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const g = ctx()!; const p = pos(e); const l = last.current;
    const mid = { x: (l.x + p.x) / 2, y: (l.y + p.y) / 2 };
    g.lineWidth = e.pointerType === 'pen' && e.pressure ? 1.2 + e.pressure * 2.6 : 2.4;
    g.beginPath(); g.moveTo(l.x, l.y); g.quadraticCurveTo(l.x, l.y, mid.x, mid.y); g.lineTo(p.x, p.y); g.stroke();
    last.current = p; dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false; last.current = null;
    if (dirty.current) onChange(canvas.current!.toDataURL('image/png'));
  };
  const clear = () => { setup(); if (mode === 'type') setTyped(''); onChange(null); };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-line p-0.5" role="tablist">
          {(['draw', 'type'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
              className={`h-9 rounded-md px-3 text-sm font-medium transition-colors ${mode === m ? 'bg-primary text-on-primary' : 'text-muted hover:text-fg'}`}>
              {m === 'draw' ? labels.draw : labels.type}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost h-9 px-3 text-sm" onClick={clear}>{labels.clear}</button>
      </div>
      {mode === 'type' && (
        <input className="input mb-2" value={typed} placeholder={labels.typePlaceholder} aria-label={labels.typePlaceholder}
          dir="auto" autoComplete="name" onChange={(e) => { setTyped(e.target.value); renderTyped(e.target.value); }} />
      )}
      <div className="relative rounded-lg border-2 border-dashed border-line-strong bg-white">
        <canvas ref={canvas} className={`block h-36 w-full ${mode === 'draw' ? 'cursor-crosshair touch-none' : ''}`}
          role="img" aria-label={labels.canvasLabel}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
        <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-gray-300" />
        <span className="pointer-events-none absolute bottom-2 start-6 text-xs text-gray-400">{labels.hint}</span>
      </div>
    </div>
  );
}
