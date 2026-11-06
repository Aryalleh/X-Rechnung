import type { ReactNode } from 'react';
import { parseBlocks, type Part } from '../../lib/contract-doc';

type Values = Record<string, string | boolean>;

/**
 * Renders contract text. Modes:
 *   preview — {{variables}} shown with values (or highlighted when missing), [[fields]] as blanks
 *   fill    — [[fields]] are live inputs for the signer
 *   static  — [[fields]] show the signer's values (read-only)
 */
export function ContractDoc({ body, mode, vars = {}, values = {}, onValue, formatDate, showErrors }: {
  body: string; mode: 'preview' | 'fill' | 'static'; vars?: Record<string, string>; values?: Values;
  onValue?: (key: string, v: string | boolean) => void; formatDate?: (iso: string) => string; showErrors?: boolean;
}) {
  const part = (p: Part, i: number): ReactNode => {
    if (p.kind === 'text') return <span key={i}>{p.text}</span>;
    if (p.kind === 'var') {
      const v = vars[p.key];
      return v?.trim()
        ? <span key={i} className="rounded bg-primary-soft/60 px-0.5 text-fg">{v}</span>
        : <mark key={i} className="rounded bg-warning-soft px-1 font-mono text-[0.85em] text-warning">{`{{${p.key}}}`}</mark>;
    }
    const f = p.field;
    const v = values[f.key];
    if (mode === 'fill' && onValue) {
      const empty = f.required && (v == null || String(v).trim() === '');
      const ring = empty && showErrors ? 'border-danger ring-1 ring-danger' : empty ? 'border-warning bg-warning-soft/40' : 'border-line-strong';
      if (f.type === 'checkbox') {
        return (
          <label key={i} className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 align-middle">
            <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={v === true} onChange={(e) => onValue(f.key, e.target.checked)} />
            <span className="font-medium">{f.label}</span>
          </label>
        );
      }
      return (
        <input key={i} id={`fld-${f.key}`} aria-label={f.label} placeholder={f.label} required={f.required}
          aria-invalid={empty && showErrors ? true : undefined}
          type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} dir="auto"
          className={`mx-0.5 inline-block h-9 min-w-[10rem] max-w-full rounded-md border px-2 align-baseline text-[0.95em] font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 ${ring}`}
          value={typeof v === 'string' ? v : ''} onChange={(e) => onValue(f.key, e.target.value)} />
      );
    }
    if (f.type === 'checkbox') return <span key={i}><span aria-hidden="true">{v ? '☑' : '☐'}</span> {f.label}</span>;
    if (mode === 'static' && v != null && v !== '') {
      return <span key={i} className="border-b border-fg px-1 font-semibold">{f.type === 'date' && formatDate ? formatDate(String(v)) : String(v)}</span>;
    }
    return <span key={i} className="mx-0.5 inline-block min-w-[8rem] rounded-sm border-b border-dashed border-muted px-1 text-xs text-muted">{f.label}</span>;
  };

  return (
    <div className="contract-doc space-y-2 text-[15px] leading-7">
      {parseBlocks(body).map((b, bi) => {
        const inner = b.lines.map((l, li) => <span key={li}>{li > 0 && <br />}{l.map(part)}</span>);
        if (b.type === 'h1') return <h2 key={bi} className="pb-1 pt-2 text-2xl font-bold leading-tight">{inner}</h2>;
        if (b.type === 'h2') return <h3 key={bi} className="pt-3 text-base font-semibold">{inner}</h3>;
        if (b.type === 'li') return <div key={bi} className="flex gap-2"><span className="min-w-[1.5rem] text-muted">{b.marker}</span><div>{inner}</div></div>;
        return <p key={bi}>{inner}</p>;
      })}
    </div>
  );
}
