/**
 * A personal, browser-local income record for tax time. It cannot see
 * activity from other devices, and says so — it is a notebook, not a ledger
 * of truth. Exports to CSV with formula-injection protection.
 */
import { useState } from 'react';
import { CSV_BOM, recordsToCsv } from '@plumbline/core';
import { Button, Field, Panel } from '../../components/ui.tsx';
import { downloadText } from '../../lib/hooks.ts';
import { store } from '../../lib/storage.ts';

interface Entry extends Record<string, unknown> {
  date: string;
  type: 'earning' | 'withdrawal' | 'stake' | 'slash';
  amount: string;
  question: string;
  transaction: string;
}

const KEY = 'ledgerBook.v1';
const COLUMNS = ['date', 'type', 'amount', 'question', 'transaction'] as const;

export function LedgerBook() {
  const [entries, setEntries] = useState<Entry[]>(() => store.getJson<Entry[]>(KEY, []));
  const [draft, setDraft] = useState<Entry>({ date: new Date().toISOString().slice(0, 10), type: 'earning', amount: '', question: '', transaction: '' });

  const save = (next: Entry[]) => {
    setEntries(next);
    store.setJson(KEY, next);
  };
  const total = entries.reduce((sum, e) => sum + (e.type === 'earning' ? 1 : e.type === 'slash' ? -1 : 0) * Number(e.amount || 0), 0);

  return (
    <Panel title="Ledger book" eyebrow="Personal record" action={<Button variant="ghost" size="sm" disabled={!entries.length} onClick={() => downloadText(`plumbline-ledger-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8', CSV_BOM + recordsToCsv([...COLUMNS], entries))}>Export CSV</Button>}>
      <p className="faint small">Saved in this browser only. Use it to keep your own income notes for tax time.</p>
      <form
        className="grid cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          const amount = Number(draft.amount);
          if (!Number.isFinite(amount) || amount <= 0) return;
          save([{ ...draft, amount: amount.toFixed(7) }, ...entries]);
          setDraft({ ...draft, amount: '', question: '', transaction: '' });
        }}
      >
        <Field label="Date">
          <input className="input" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
        </Field>
        <Field label="Type">
          <select className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Entry['type'] })}>
            <option value="earning">Earning</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="stake">Bond added</option>
            <option value="slash">Slashed</option>
          </select>
        </Field>
        <Field label="Amount (USDC)">
          <input className="input num" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} required />
        </Field>
        <Field label="Tx / question ref">
          <input className="input mono" value={draft.transaction} onChange={(e) => setDraft({ ...draft, transaction: e.target.value })} />
        </Field>
        <div>
          <Button type="submit" size="sm">
            Add entry
          </Button>
        </div>
      </form>
      <p className="small" style={{ marginTop: 12 }}>
        <strong className="num">{entries.length}</strong> entries · net earnings <strong className="num">{total.toFixed(2)} USDC</strong>
      </p>
      {entries.length > 0 && (
        <div className="table-wrap compact">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th className="num">Amount</th>
                <th>Ref</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 12).map((e, i) => (
                <tr key={`${e.date}-${i}`}>
                  <td className="mono">{e.date}</td>
                  <td>{e.type}</td>
                  <td className="num">{e.amount}</td>
                  <td className="mono faint break">{e.transaction || '—'}</td>
                  <td>
                    <button className="star" aria-label="Delete entry" onClick={() => save(entries.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
