// Compare contractor offers of a project with AI: positions side by side, gaps, price check, questions.
import { Icon } from './icons.jsx';
import { Btn, Pill } from './common.jsx';
import { AiRunner } from './ai-ui.jsx';
import { toast } from './state.js';
import { aiCompareOffers } from '../ai.js';
import { addCost } from '../actions.js';
import { fmtEuro, fmtDate, isISO } from '../util.js';

const { useState } = React;

export function OfferCompare({ p, data, set }) {
  const docs = Object.values(data.documents || {}).filter((d) => d.projectId === p.id && (d.assetId || d.dataUrl || d.ai?.data));
  const offerLike = (d) => d.type === 'angebot' || /angebot|kostenvoranschlag/i.test(d.name || '');
  const [sel, setSel] = useState(() => docs.filter(offerLike).map((d) => d.id).slice(0, 5));
  const chosen = docs.filter((d) => sel.includes(d.id));
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-5)));
  if (!docs.length)
    return (
      <div className="callout">
        <Icon name="file" size={16} />
        <span>Lade Angebote unten bei „Dokumente“ hoch (PDF oder Foto). Dann vergleicht die KI sie hier Position für Position.</span>
      </div>
    );
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="field-label">Angebote auswählen ({chosen.length} von höchstens 5)</span>
      <div className="chips">
        {docs.map((d) => (
          <button key={d.id} className={`chip ${sel.includes(d.id) ? 'is-on' : ''}`} onClick={() => toggle(d.id)} title={d.name}>
            <Icon name={sel.includes(d.id) ? 'checkCircle' : 'file'} size={13} /> {d.name.length > 34 ? d.name.slice(0, 32) + '…' : d.name}
          </button>
        ))}
      </div>
      <AiRunner
        title="Angebote mit KI vergleichen"
        icon="euro"
        desc="Stellt die Leistungen nebeneinander, findet fehlende Positionen, prüft Preise und Förderbedingungen und formuliert Rückfragen an die Anbieter."
        saved={p.ai?.offers}
        cta={chosen.length > 1 ? `${chosen.length} Angebote vergleichen` : 'Angebot prüfen'}
        run={(signal) => {
          if (!chosen.length) throw { code: 'empty_completion' };
          return aiCompareOffers(p, chosen, data, { signal });
        }}
        onSave={(rec) => set({ ai: { ...(p.ai || {}), offers: { ...rec, docs: chosen.map((d) => ({ id: d.id, name: d.name })) } } })}
        render={(r) => <OfferResult r={r} p={p} data={data} />}
      />
    </div>
  );
}

function OfferResult({ r, p, data }) {
  const offers = r.offers || [];
  const name = (id) => offers.find((o) => o.offerId === id)?.vendor || data.documents?.[id]?.name || id;
  const best = r.recommendation?.offerId;
  const take = (o) => {
    addCost(p.id, { label: `Angebot ${o.vendor || name(o.offerId)}`, offer: Number(o.total) || null, vendor: o.vendor || '' });
    toast(`Angebot von ${o.vendor || 'Anbieter'} als Kostenposition übernommen`);
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      {r.summary ? <p className="ai-summary">{r.summary}</p> : null}
      {best ? (
        <div className="callout callout-info">
          <Icon name="checkCircle" size={16} />
          <span>
            <b>Empfehlung: {name(best)}.</b> {r.recommendation.reason}
          </span>
        </div>
      ) : null}
      {(r.positions || []).length && offers.length ? (
        <div className="table-wrap">
          <table className="tbl offer-tbl">
            <thead>
              <tr>
                <th>Leistung</th>
                {offers.map((o) => (
                  <th key={o.offerId} className="r">
                    {o.vendor || name(o.offerId)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.positions.map((pos, i) => (
                <tr key={i}>
                  <td>
                    {pos.label}
                    {pos.note ? <div className="small muted">{pos.note}</div> : null}
                  </td>
                  {offers.map((o) => {
                    const v = pos.values?.[o.offerId];
                    return (
                      <td key={o.offerId} className="r">
                        {v == null || v === '' ? <span className="offer-missing">fehlt</span> : typeof v === 'number' ? fmtEuro(v) : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="offer-total">
                <td>Summe</td>
                {offers.map((o) => (
                  <td key={o.offerId} className="r">
                    {o.total ? fmtEuro(o.total) : '–'}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="offer-cards">
        {offers.map((o) => (
          <div key={o.offerId} className={`offer-card ${o.offerId === best ? 'is-best' : ''}`}>
            <div className="spread">
              <b>{o.vendor || name(o.offerId)}</b>
              {o.offerId === best ? <Pill tone="accent">Empfehlung</Pill> : null}
            </div>
            <div className="small muted">
              {o.total ? fmtEuro(o.total) : 'Summe unklar'}
              {isISO(o.date) ? ` · vom ${fmtDate(o.date)}` : ''}
              {isISO(o.validUntil) ? ` · gültig bis ${fmtDate(o.validUntil)}` : ''}
            </div>
            {(o.strengths || []).length ? <List title="Stärken" items={o.strengths} /> : null}
            {(o.weaknesses || []).length ? <List title="Schwächen" items={o.weaknesses} /> : null}
            {(o.missing || []).length ? <List title="Fehlt oder unklar" items={o.missing} tone="warn" /> : null}
            {(o.questions || []).length ? <List title="Rückfragen" items={o.questions} /> : null}
            {o.total ? (
              <Btn small icon="plus" onClick={() => take(o)}>
                Als Kostenposition übernehmen
              </Btn>
            ) : null}
          </div>
        ))}
      </div>
      {(r.funding || []).length ? <List title="Förderung" items={r.funding} /> : null}
      {(r.warnings || []).length ? <List title="Auffälligkeiten" items={r.warnings} tone="warn" /> : null}
    </div>
  );
}

function List({ title, items, tone }) {
  return (
    <div>
      <span className="field-label">{title}</span>
      <ul className="small" style={{ margin: '2px 0 0', paddingLeft: 18, color: tone === 'warn' ? 'var(--warn-ink)' : undefined }}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
