import { Icon } from './icons.jsx';
import { Btn } from './common.jsx';
import { getSample, aiErrorText, AI_DISCLAIMER } from '../ai.js';
import { fmtTime } from '../util.js';

const { useState, useEffect, useRef } = React;

let availCache = null;
export function useAiAvailable() {
  const [avail, setAvail] = useState(availCache);
  useEffect(() => {
    if (availCache !== null) return;
    let alive = true;
    getSample().then((s) => {
      availCache = !!s;
      if (alive) setAvail(availCache);
    });
    return () => (alive = false);
  }, []);
  return avail;
}

export function AiUnavailable() {
  return (
    <div className="ai-note">
      <Icon name="info" size={14} />
      <span>KI-Funktionen stehen zur Verfügung, wenn die Hausakte in claude.ai geöffnet ist.</span>
    </div>
  );
}

// Runs one AI analysis, shows progress, keeps the last result (saved via onSave) and renders it.
export function AiRunner({ title, desc, icon = 'sparkles', saved, run, onSave, render, cta = 'Mit KI prüfen', compact, autoRun }) {
  const avail = useAiAvailable();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [fresh, setFresh] = useState(null);
  const ctl = useRef(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const result = fresh || saved;
  const go = async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setBusy(true);
    setErr(null);
    try {
      const data = await run(c.signal);
      if (c.signal.aborted) return;
      const rec = { at: Date.now(), data };
      setFresh(rec);
      onSave?.(rec);
    } catch (e) {
      if (e?.code !== 'cancelled') setErr(aiErrorText(e));
    } finally {
      if (ctl.current === c) setBusy(false);
    }
  };
  useEffect(() => {
    if (autoRun) go();
  }, [autoRun]);
  return (
    <div className={`ai-box ${compact ? 'is-compact' : ''}`}>
      <div className="ai-head">
        <Icon name={icon} size={16} />
        <b>{title}</b>
        {result && !busy ? <small>{fmtTime(result.at)}</small> : null}
      </div>
      {!result && !busy && desc ? <p className="small muted">{desc}</p> : null}
      {busy ? (
        <div className="ai-thinking">
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
          <span>KI denkt nach … das kann bis zu einer Minute dauern.</span>
          <Btn small kind="ghost" icon="stop" onClick={() => ctl.current?.abort()}>
            Stopp
          </Btn>
        </div>
      ) : null}
      {err ? (
        <div className="ai-err">
          <Icon name="alert" size={15} />
          <span>{err}</span>
        </div>
      ) : null}
      {result && !busy ? render(result.data) : null}
      {!busy ? (
        avail === false ? (
          <AiUnavailable />
        ) : (
          <div className="ai-actions">
            <Btn small kind="ai" icon="sparkles" onClick={go}>
              {result ? 'Neu prüfen' : cta}
            </Btn>
          </div>
        )
      ) : null}
      {result && !busy ? (
        <div className="ai-note">
          <Icon name="info" size={13} />
          <span>{AI_DISCLAIMER}</span>
        </div>
      ) : null}
    </div>
  );
}

// Minimal Markdown: paragraphs, "- " lists, "### " headings, **bold**.
export function Md({ text }) {
  const blocks = [];
  let list = null;
  const inline = (s, k) => {
    const parts = String(s).split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={k + '-' + i}>{p.slice(2, -2)}</b> : p));
  };
  String(text || '')
    .split('\n')
    .forEach((line, i) => {
      const t = line.trimEnd();
      const li = t.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
      if (li) {
        if (!list) {
          list = [];
          blocks.push({ list });
        }
        list.push(inline(li[1], i));
        return;
      }
      list = null;
      if (!t.trim()) return;
      const h = t.match(/^#{1,4}\s+(.*)/);
      if (h) blocks.push({ h: inline(h[1], i) });
      else blocks.push({ p: inline(t, i) });
    });
  return (
    <>
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i}>
            {b.list.map((x, j) => (
              <li key={j}>{x}</li>
            ))}
          </ul>
        ) : b.h ? (
          <h4 key={i}>{b.h}</h4>
        ) : (
          <p key={i}>{b.p}</p>
        ),
      )}
    </>
  );
}
