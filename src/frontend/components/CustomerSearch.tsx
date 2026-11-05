/** Smart customer search: shared hook, inline combobox and Ctrl+K palette. */
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Icon, Spinner } from '../ui';

export interface CustomerHit {
  id: string;
  customer_code: string;
  customer_type: string;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  city: string | null;
  phone: string | null;
  is_active: number;
}

export function customerName(c: Pick<CustomerHit, 'company_name' | 'first_name' | 'last_name' | 'customer_code'>): string {
  return c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.customer_code;
}

/** Debounced, cancel-safe search; empty query returns recent customers. */
export function useCustomerSearch(query: string, enabled = true, limit = 8, version = 0) {
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    const h = setTimeout(() => {
      api.get<CustomerHit[]>(`/customers/search?limit=${limit}&q=${encodeURIComponent(query.trim())}`)
        .then((r) => { if (!cancelled) setHits(r); })
        .catch(() => { if (!cancelled) setHits([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, query ? 150 : 0);
    return () => { cancelled = true; clearTimeout(h); };
  }, [query, enabled, limit, version]);
  return { hits, loading };
}

function Avatar({ c }: { c: CustomerHit }) {
  const name = customerName(c);
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-fg">
      {c.customer_type === 'PRIVATE' ? <Icon name="user" className="h-4 w-4" /> : name.trim().charAt(0).toUpperCase() || '#'}
    </span>
  );
}

function HitRow({ c, active }: { c: CustomerHit; active: boolean }) {
  const { num } = useI18n();
  const meta = [c.city, c.email].filter(Boolean).join(' · ');
  return (
    <div className={`flex items-center gap-3 px-3 py-2 ${active ? 'bg-primary-soft' : ''}`}>
      <Avatar c={c} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{customerName(c)}</div>
        {meta && <div className="truncate text-xs text-muted">{meta}</div>}
      </div>
      <span className="font-mono text-xs text-muted" dir="ltr">{num(c.customer_code)}</span>
    </div>
  );
}

/** Inline combobox (ARIA 1.2 pattern) used in the invoice form. */
export function CustomerCombobox({ onSelect, onCreate, autoFocus }: { onSelect: (c: CustomerHit) => void; onCreate?: (q: string) => void; autoFocus?: boolean }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { hits, loading } = useCustomerSearch(q, open);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => { setActive(0); }, [hits]);
  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const choose = (c: CustomerHit) => { onSelect(c); setOpen(false); setQ(''); };

  return (
    <div ref={wrap} className="relative">
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          className="input ps-9" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
          placeholder={t('ni.customer_placeholder')} value={q} autoFocus={autoFocus}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, hits.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (hits[active]) choose(hits[active]!); }
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {loading && <span className="absolute end-3 top-1/2 -translate-y-1/2 text-muted"><Spinner /></span>}
      </div>
      {open && (
        <div id={listId} role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-xl border border-line bg-surface py-1 shadow-lg">
          {!q && hits.length > 0 && <div className="px-3 pb-1 pt-2 text-xs font-medium text-muted">{t('palette.recent')}</div>}
          {hits.map((c, i) => (
            <div key={c.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className="cursor-pointer"
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(c); }}>
              <HitRow c={c} active={i === active} />
            </div>
          ))}
          {!loading && hits.length === 0 && <div className="px-3 py-3 text-sm text-muted">{t('ni.no_customer')}</div>}
          {onCreate && (
            <button type="button" className="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-sm font-medium text-primary-fg hover:bg-surface-2"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); onCreate(q); }}>
              <Icon name="plus" /> {t('ni.create_customer')}
            </button>
          )}
        </div>
      )}
      <p className="hint">{t('ni.customer_hint')}</p>
    </div>
  );
}

/** Global Ctrl/Cmd+K palette: find a customer and jump to a new invoice for them. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const { hits, loading } = useCustomerSearch(q, open, 8);
  const input = useRef<HTMLInputElement>(null);

  const actions = [
    { label: t('nav.new_invoice'), icon: 'filePlus' as const, to: '/invoices/new' },
    { label: t('cust.new'), icon: 'users' as const, to: '/customers?new=1' },
    { label: t('nav.invoices'), icon: 'file' as const, to: '/invoices' },
  ];
  const total = hits.length + (q ? 0 : actions.length);

  useEffect(() => { if (open) { setQ(''); setTimeout(() => input.current?.focus(), 20); } }, [open]);
  useEffect(() => { setActive(0); }, [hits, q]);
  if (!open) return null;

  const go = (i: number) => {
    if (i < hits.length) nav(`/invoices/new?customer=${hits[i]!.id}`);
    else { const a = actions[i - hits.length]; if (a) nav(a.to); }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('nav.search')} className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Icon name="search" className="h-5 w-5 text-muted" />
          <input ref={input} className="h-14 w-full bg-transparent text-base text-fg outline-none placeholder:text-muted/70" placeholder={t('palette.placeholder')}
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, total - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); go(active); }
              else if (e.key === 'Escape') onClose();
            }} />
          {loading && <Spinner />}
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {hits.length > 0 && <div className="px-4 pb-1 pt-1 text-xs font-medium text-muted">{q ? t('palette.customers') : t('palette.recent')}</div>}
          {hits.map((c, i) => (
            <button key={c.id} type="button" className="block w-full text-start" onMouseEnter={() => setActive(i)} onClick={() => go(i)}>
              <HitRow c={c} active={i === active} />
            </button>
          ))}
          {q && !loading && hits.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted">{t('palette.no_results')}</div>}
          {!q && (
            <>
              <div className="px-4 pb-1 pt-3 text-xs font-medium text-muted">{t('palette.actions')}</div>
              {actions.map((a, j) => {
                const i = hits.length + j;
                return (
                  <button key={a.to} type="button" onMouseEnter={() => setActive(i)} onClick={() => go(i)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm ${i === active ? 'bg-primary-soft text-primary-fg' : 'text-fg'}`}>
                    <Icon name={a.icon} className="h-4 w-4" /> {a.label}
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div className="border-t border-line px-4 py-2 text-xs text-muted">{t('palette.hint')}</div>
      </div>
    </div>
  );
}
