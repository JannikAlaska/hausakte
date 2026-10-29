import { Icon } from './icons.jsx';
import { parseNum, fmtNum } from '../util.js';

const { useState, useEffect, useRef } = React;

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

export function Drawer({ eyebrow, title, subtitle, icon, onClose, children, footer, className = '' }) {
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
      <div className="drawer-body">{children}</div>
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
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-on' : ''} onClick={() => onChange(o.value)} title={o.title || o.label}>
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
