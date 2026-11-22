// Who pays an invoice: several rows per invoice, each a person with a share in percent or as an amount and
// whether it comes from own funds or a loan. Names entered once are suggested again in every invoice.
import { Icon } from './icons.jsx';
import { IconBtn, NumInput, Seg, Section } from './common.jsx';
import { PAY_SOURCES, payersOf, payerSplit, payerNames, payerShare, payerTotals, setPayers } from '../invoices.js';
import { uid, fmtNum } from '../util.js';

const eur = (n) => (n == null || !Number.isFinite(Number(n)) ? '–' : Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
const pct = (n) => (n == null || !Number.isFinite(Number(n)) ? '–' : `${fmtNum(n, 1)} %`);

export function PayerSection({ d, data }) {
  const rows = payersOf(d);
  const sp = payerSplit(d);
  const names = payerNames(data);
  const listId = 'payer-names-' + d.id;
  const used = new Set(rows.map((x) => String(x.name || '').trim().toLocaleLowerCase('de')));
  const save = (next) => setPayers(d.id, next);
  const upd = (id, patch) => save(rows.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  // a new row takes over how the last one was entered and gets what is still open
  const add = (name = '') => {
    const last = rows[rows.length - 1];
    const mode = last?.mode || 'prozent';
    const rest = mode === 'betrag' ? sp.restEur : sp.restPct;
    save([...rows, { id: uid('py'), name, mode, value: rest != null && rest > 0 ? rest : rows.length ? null : mode === 'prozent' ? 100 : sp.total || null, source: last?.source || 'eigen' }]);
  };
  // switching % <-> € keeps the share the same when the invoice total is known
  const setMode = (x, mode) => {
    if (mode === x.mode) return;
    const s = payerShare(x, sp.total);
    const value = mode === 'betrag' ? s.eur : s.pct != null ? Math.round(s.pct * 100) / 100 : null;
    upd(x.id, { mode, value: x.value == null ? null : value });
  };
  const fillRest = (x) => {
    const s = payerShare(x, sp.total);
    if (x.mode === 'betrag' && sp.restEur != null) upd(x.id, { value: Math.round(((s.eur || 0) + sp.restEur) * 100) / 100 });
    else if (x.mode !== 'betrag' && sp.restPct != null) upd(x.id, { value: Math.round(((s.pct || 0) + sp.restPct) * 100) / 100 });
  };
  const status = !rows.length ? null : sp.done ? (
    <span className="pay-ok">
      <Icon name="check" size={13} /> vollständig verteilt
    </span>
  ) : sp.over ? (
    <span className="pay-over">{pct(-sp.restPct)} zu viel</span>
  ) : sp.restPct != null ? (
    <span className="pay-rest">noch {pct(sp.restPct)} offen</span>
  ) : null;
  return (
    <Section title="Wer zahlt?" aside={status}>
      <datalist id={listId}>
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {rows.length ? (
        <div className="pay-rows">
          {sp.rows.map((x) => {
            const other = x.mode === 'betrag' ? pct(x.pct) : eur(x.eur);
            return (
              <div key={x.id} className={`pay-row ${x.source === 'kredit' ? 'is-loan' : ''}`}>
                <input className="input pay-name" list={listId} value={x.name || ''} onChange={(e) => upd(x.id, { name: e.target.value })} placeholder="Name" aria-label="Wer zahlt" autoComplete="off" />
                <div className="pay-tools">
                  {!sp.done && !sp.over && (x.mode === 'betrag' ? sp.restEur > 0 : sp.restPct > 0) ? <IconBtn icon="plus" size={15} label="Rest dieser Zeile zuschlagen" onClick={() => fillRest(x)} /> : null}
                  <IconBtn icon="x" size={15} label="Zeile entfernen" onClick={() => save(rows.filter((y) => y.id !== x.id))} />
                </div>
                <div className="pay-line2">
                <div className="pay-amount">
                  <Seg small value={x.mode === 'betrag' ? 'betrag' : 'prozent'} onChange={(m) => setMode(x, m)} options={[{ value: 'prozent', label: '%', title: 'Anteil in Prozent' }, { value: 'betrag', label: '€', title: 'Betrag in Euro' }]} />
                  <NumInput value={x.value} onChange={(v) => upd(x.id, { value: v })} unit={x.mode === 'betrag' ? '€' : '%'} digits={2} min={0} aria-label={x.mode === 'betrag' ? 'Betrag' : 'Anteil in Prozent'} />
                  <span className="pay-other" title={x.mode === 'betrag' ? 'Anteil an der Rechnung' : 'Betrag'}>
                    = {other}
                  </span>
                </div>
                <Seg small value={x.source === 'kredit' ? 'kredit' : 'eigen'} onChange={(v) => upd(x.id, { source: v })} options={PAY_SOURCES.map((s) => ({ value: s.key, label: s.name }))} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="small muted">Halte fest, wer die Rechnung (anteilig) zahlt – in Prozent oder als Betrag, aus Eigenmitteln oder per Kredit.</p>
      )}
      {rows.length && sp.total > 0 ? (
        <div className="pay-sum small">
          <span>
            Rechnung <b>{eur(sp.total)}</b>
          </span>
          <span>
            verteilt <b>{eur(sp.eur)}</b> ({pct(sp.pct)})
          </span>
          {!sp.done ? (
            <span className={sp.over ? 'pay-over' : 'pay-rest'}>
              {sp.over ? 'zu viel' : 'offen'} <b>{eur(Math.abs(sp.restEur))}</b>
            </span>
          ) : null}
        </div>
      ) : rows.length && rows.some((x) => x.mode === 'betrag') ? (
        <p className="small muted">Trage den Rechnungsbetrag ein, dann rechne ich Beträge und Prozente ineinander um.</p>
      ) : null}
      <div className="chips pay-add">
        {names
          .filter((n) => !used.has(n.toLocaleLowerCase('de')))
          .slice(0, 6)
          .map((n) => (
            <button key={n} type="button" className="chip chip-add" onClick={() => add(n)}>
              <Icon name="plus" size={13} /> {n}
            </button>
          ))}
        <button type="button" className="chip chip-add" onClick={() => add('')}>
          <Icon name="plus" size={13} /> {names.length ? 'Andere Person' : 'Person hinzufügen'}
        </button>
      </div>
    </Section>
  );
}

// short form for the invoice list: "Jannik 30 % · Anna 20 %"
export function payerLine(d) {
  const sp = payerSplit(d);
  if (!sp.rows.length) return '';
  return sp.rows
    .map((x) => `${String(x.name || '').trim() || '?'} ${x.mode === 'betrag' ? eur(x.eur) : pct(x.pct)}${x.source === 'kredit' ? ' (Kredit)' : ''}`)
    .join(' · ');
}

// overview per person over the invoices shown (all, or those of one project)
export function PayerTotals({ list }) {
  const t = payerTotals(list);
  if (!t.people.length) return null;
  return (
    <div className="panel pay-totals">
      <div className="panel-head">
        <h3>Wer zahlt was</h3>
        <span className="small muted">Anteile an {list.length === 1 ? 'der Rechnung' : `${list.length} Rechnungen`}</span>
      </div>
      <div className="table-wrap">
        <table className="tbl fin-tbl">
          <thead>
            <tr>
              <th>Person</th>
              <th className="r">Eigenmittel</th>
              <th className="r">Kredit</th>
              <th className="r">Gesamt</th>
            </tr>
          </thead>
          <tbody>
            {t.people.map((p) => (
              <tr key={p.name}>
                <td>
                  {p.name} <span className="muted small">· {p.n} Rechnung{p.n === 1 ? '' : 'en'}</span>
                </td>
                <td className="r">{p.eigen ? eur(p.eigen) : '–'}</td>
                <td className="r">{p.kredit ? eur(p.kredit) : '–'}</td>
                <td className="r">
                  <b>{eur(p.total)}</b>
                </td>
              </tr>
            ))}
            <tr className="pay-total-row">
              <td>Summe</td>
              <td className="r">{eur(t.eigen)}</td>
              <td className="r">{eur(t.kredit)}</td>
              <td className="r">
                <b>{eur(t.eigen + t.kredit)}</b>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {t.unassigned > 0.005 ? <p className="small muted">Noch niemandem zugeordnet: {eur(t.unassigned)}</p> : null}
    </div>
  );
}
