// Verdict pill plus payback sentence for an economics() result.
import { Pill } from './common.jsx';
import { VERDICT, paybackText } from '../econ.js';

export function EconLine({ e, hint }) {
  if (!e) return null;
  const v = VERDICT[e.verdict];
  return (
    <div className="econ">
      <Pill tone={v.tone}>{v.label}</Pill>
      <span>
        {paybackText(e)}
        {hint ? <span className="muted"> · {hint}</span> : null}
      </span>
    </div>
  );
}

// Verdict from an AI answer ("wirtschaftlich|grenzwertig|unwirtschaftlich|notwendig").
export function AiVerdict({ verdict, payback, cost }) {
  if (!verdict && !payback) return null;
  const v = verdict || '';
  const pill = /^unwirt/i.test(v) ? VERDICT.nein : /grenz/i.test(v) ? VERDICT.knapp : /^wirt/i.test(v) ? VERDICT.gut : /notw|pflicht/i.test(v) ? { label: 'notwendig', tone: 'info' } : v ? { label: v } : null;
  return (
    <div className="econ">
      {pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
      <span>
        {payback ? `Amortisation: ${payback}` : null}
        {cost && cost !== '0' ? <span className="muted">{payback ? ' · ' : ''}Kosten {cost}</span> : null}
      </span>
    </div>
  );
}
