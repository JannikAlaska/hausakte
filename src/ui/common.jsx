import { Icon } from './icons.jsx';
import { parseNum, fmtNum, fmtDate } from '../util.js';
import { useUI, setInstallFilter } from './state.js';

const { useState, useEffect, useRef, useLayoutEffect } = React;

export function Btn({ kind = 'soft', icon, children, small, className = '', ...rest }) {
  return (
    <button type="button" className={`btn btn-${kind} ${small ? 'btn-sm' : ''} ${className}`} {...rest}>
      {icon ? <Icon name={icon} size={small ? 15 : 17} /> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

export function IconBtn({ icon, label, active, className = '', size = 18, ...rest }) {
  return (
    <button type="button" className={`icon-btn ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Field({ label, hint, children, wide, className = '' }) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''} ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ value, onChange, placeholder, id, multiline, rows = 3, ...rest }) {
  if (multiline)
    return <textarea id={id} className="input" rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...rest} />;
  return <input id={id} className="input" type="text" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...rest} />;
}

// One-line text that wraps and grows with its content instead of cutting long entries off.
// Enter ends editing (the entry stays a single line of text).
export function AutoText({ value, onChange, className = '', ...rest }) {
  const ref = useRef(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + (el.offsetHeight - el.clientHeight) + 'px';
  };
  useLayoutEffect(fit, [value]);
  // re-wrap when the column gets wider or narrower (drawer resized, phone rotated)
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !ref.current) return;
    let w = 0;
    const ro = new ResizeObserver((es) => {
      const nw = Math.round(es[0]?.contentRect.width || 0);
      if (nw !== w) {
        w = nw;
        fit();
      }
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`input auto-text ${className}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value.replace(/\s*\n+\s*/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      {...rest}
    />
  );
}

// A choice as a small chip showing the current option; tapping it opens the system list.
export function SelectChip({ value, onChange, options, label, className = '' }) {
  const cur = options.find((o) => o.value === value) || options[0];
  return (
    <span className={`select-chip ${className}`}>
      <span>{cur?.label}</span>
      <Icon name="chevD" size={12} />
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label} title={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

// A date as a small chip ("bis 27.11.2026"); tapping it opens the system date picker.
export function DateChip({ value, onChange, prefix = '', empty = 'Datum', late, label = 'Datum' }) {
  return (
    <span className={`date-chip ${value ? 'has' : ''} ${late ? 'is-late' : ''}`}>
      <Icon name="calendar" size={12} />
      <span>{value ? `${prefix ? prefix + ' ' : ''}${fmtDate(value)}` : empty}</span>
      <input
        type="date"
        value={value || ''}
        aria-label={label}
        title={label}
        onChange={(e) => onChange(e.target.value || null)}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.();
          } catch {}
        }}
      />
    </span>
  );
}

// Number input that accepts German decimals; commits parsed numbers (or null) while typing.
export function NumInput({ value, onChange, placeholder, unit, id, digits = 2, min, max, ...rest }) {
  const [text, setText] = useState(value == null ? '' : fmtNum(value, digits).replace(/\./g, ''));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : fmtNum(value, digits).replace(/\./g, ''));
  }, [value, digits]);
  return (
    <span className="input-wrap">
      <input
        id={id}
        className="input num"
        style={unit ? { paddingRight: 14 + String(unit).length * 7 } : undefined}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(value == null ? '' : fmtNum(value, digits).replace(/\./g, ''));
        }}
        onChange={(e) => {
          setText(e.target.value);
          let n = parseNum(e.target.value);
          if (n != null && min != null) n = Math.max(min, n);
          if (n != null && max != null) n = Math.min(max, n);
          if (e.target.value.trim() === '' || n != null) onChange(n);
        }}
        {...rest}
      />
      {unit ? <span className="input-unit">{unit}</span> : null}
    </span>
  );
}

export function Select({ value, onChange, options, id, placeholder, ...rest }) {
  return (
    <select id={id} className="input select" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder != null ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DateInput({ value, onChange, id, ...rest }) {
  return <input id={id} className="input date" type="date" value={value || ''} onChange={(e) => onChange(e.target.value || null)} {...rest} />;
}

export function Toggle({ checked, onChange, label, id }) {
  return (
    <label className="toggle">
      <input id={id} type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label ? <span className="toggle-label">{label}</span> : null}
    </label>
  );
}

export function Pill({ tone = 'neutral', children, icon, className = '', ...rest }) {
  return (
    <span className={`pill pill-${tone} ${className}`} {...rest}>
      {icon ? <Icon name={icon} size={13} stroke={2} /> : null}
      {children}
    </span>
  );
}

export function Section({ n, title, aside, children, className = '' }) {
  return (
    <section className={`dsec ${className}`}>
      <header className="dsec-head">
        {n != null ? <span className="dsec-n">{n}</span> : null}
        <h3>{title}</h3>
        {aside ? <div className="dsec-aside">{aside}</div> : null}
      </header>
      <div className="dsec-body">{children}</div>
    </section>
  );
}

export function Drawer({ eyebrow, title, subtitle, icon, onClose, children, footer, className = '', tabs, tab, onTab }) {
  const body = useRef(null);
  const bar = useRef(null);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    bar.current?.querySelector('.tab.is-on')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [tab]);
  // fade the tab bar edge while more tabs are hidden to the right
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const upd = () => {
      el.toggleAttribute('data-more', el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
      el.toggleAttribute('data-less', el.scrollLeft > 4);
    };
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', upd);
      ro.disconnect();
    };
  }, [!!tabs]);
  return (
    <aside className={`drawer ${className}`} aria-label={title}>
      <header className="drawer-head">
        {icon ? (
          <span className="drawer-icon">
            <Icon name={icon} size={20} />
          </span>
        ) : null}
        <div className="drawer-titles">
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <h2>{title}</h2>
          {subtitle ? <div className="drawer-sub">{subtitle}</div> : null}
        </div>
        <IconBtn icon="x" label="Schließen" onClick={onClose} />
      </header>
      {tabs ? (
        <nav className="tabs drawer-tabs" role="tablist" ref={bar}>
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? 'is-on' : ''}`} onClick={() => onTab(t.key)}>
              {t.warn ? <Icon name="alert" size={14} className="tab-warn" /> : null}
              {t.label}
              {t.count != null ? <span className="tab-count">{t.count}</span> : null}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="drawer-body" ref={body}>
        {children}
      </div>
      {footer ? <footer className="drawer-foot">{footer}</footer> : null}
    </aside>
  );
}

export function Sheet({ title, icon, eyebrow, actions, tabs, tab, onTab, children, className = '', onClose }) {
  return (
    <section className={`sheet ${className}`}>
      <header className="sheet-head">
        <div className="sheet-title">
          {icon ? (
            <span className="sheet-icon">
              <Icon name={icon} size={20} />
            </span>
          ) : null}
          <div>
            {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
            <h2>{title}</h2>
          </div>
        </div>
        <div className="sheet-actions">
          {actions}
          {onClose ? <IconBtn icon="x" label="Zum 3D-Modell" onClick={onClose} /> : null}
        </div>
      </header>
      {tabs ? (
        <nav className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? 'is-on' : ''}`} onClick={() => onTab(t.key)}>
              {t.icon ? <Icon name={t.icon} size={15} /> : null}
              {t.label}
              {t.count != null ? <span className="tab-count">{t.count}</span> : null}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="sheet-body">{children}</div>
    </section>
  );
}

export function Empty({ icon = 'info', title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={22} />
      </span>
      <div>
        <b>{title}</b>
        {children ? <p>{children}</p> : null}
      </div>
      {action}
    </div>
  );
}

// Two-step destructive button (the viewer frame has no confirm()).
export function ConfirmBtn({ children = 'Löschen', confirmText = 'Wirklich löschen?', onConfirm, small = true, icon = 'trash' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return armed ? (
    <Btn kind="danger" small={small} icon="alert" onClick={() => { setArmed(false); onConfirm(); }}>
      {confirmText}
    </Btn>
  ) : (
    <Btn kind="ghost" small={small} icon={icon} onClick={() => setArmed(true)}>
      {children}
    </Btn>
  );
}

export function Meter({ ratio, tone }) {
  const pct = Math.max(0, Math.min(100, (ratio ?? 0) * 100));
  return (
    <span className={`meter meter-${tone || 'ok'}`}>
      <span style={{ width: pct + '%' }} />
    </span>
  );
}

export function Seg({ value, onChange, options, small }) {
  return (
    <div className={`seg ${small ? 'seg-sm' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-on' : ''} onClick={() => onChange(o.value)} title={o.title || o.label} disabled={o.disabled}>
          {o.icon ? <Icon name={o.icon} size={15} /> : null}
          {o.label ? <span>{o.label}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function KV({ k, v, tone }) {
  return (
    <div className={`kv ${tone ? 'kv-' + tone : ''}`}>
      <span>{k}</span>
      <b>{v}</b>
    </div>
  );
}

// which lines and connection points are shown (floor plan and 3D model share the setting)
export function InstallFilter({ className = '' }) {
  const ui = useUI();
  const v = ui.installFilter || 'alle';
  return (
    <label className={`inst-filter ${v !== 'alle' ? 'is-on' : ''} ${className}`} title="Welche Leitungen und Anschlüsse angezeigt werden">
      <span className="sr">Leitungen und Anschlüsse anzeigen</span>
      <select value={v} onChange={(e) => setInstallFilter(e.target.value)} onPointerDown={(e) => e.stopPropagation()}>
        <option value="alle">Bestand + geplant</option>
        <option value="bestand">Nur Bestand</option>
        <option value="geplant">Nur geplant</option>
      </select>
    </label>
  );
}

// finished things are not deleted but tucked away here: collapsed, counted, still found by search
export function ArchiveSection({ title = 'Erledigt & Archiv', count, hint, open: forced, children }) {
  const [open, setOpen] = React.useState(false);
  if (!count) return null;
  const on = forced || open;
  return (
    <div className={`archive ${on ? 'is-open' : ''}`}>
      <button type="button" className="archive-head" aria-expanded={on} onClick={() => setOpen(!on)}>
        <Icon name="archive" size={15} />
        <b>{title}</b>
        <span className="tab-count">{count}</span>
        <span className="archive-hint">{on ? '' : hint || 'eingeklappt'}</span>
        <Icon name={on ? 'chevU' : 'chevD'} size={15} />
      </button>
      {on ? <div className="archive-body">{children}</div> : null}
    </div>
  );
}

// Two-stage forms: rarely used fields that are still empty wait behind "Weitere Angaben"; filled ones are always shown.
// Which fields count as empty is decided when the form opens, so a field does not jump away while it is being typed in.
const isBlank = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'number' && Number.isNaN(v));
export function useEmptyAtOpen(id, values) {
  const ref = useRef({ id: undefined, set: new Set() });
  if (ref.current.id !== id) ref.current = { id, set: new Set(Object.entries(values).filter(([, v]) => isBlank(v)).map(([k]) => k)) };
  return ref.current.set;
}

// items: [{ k, label, el }] – the hidden fields; grid: class of the field grid inside
export function MoreFields({ items, grid = 'grid2', label = 'Weitere Angaben' }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className={`more-fields ${open ? 'is-open' : ''}`}>
      <button type="button" className="more-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevU' : 'chevD'} size={14} />
        <b>{label}</b>
        {open ? null : <span>{items.map((x) => x.label).filter(Boolean).join(', ')}</span>}
      </button>
      {open ? <div className={grid}>{items.map((x) => <React.Fragment key={x.k}>{x.el}</React.Fragment>)}</div> : null}
    </div>
  );
}

// splits field entries into the ones shown right away and the ones behind "Weitere Angaben"
export function splitFields(entries, emptyAtOpen) {
  const shown = [];
  const more = [];
  for (const e of entries) (e.core || !emptyAtOpen.has(e.k) ? shown : more).push(e);
  return { shown: shown.map((e) => <React.Fragment key={e.k}>{e.el}</React.Fragment>), more };
}
