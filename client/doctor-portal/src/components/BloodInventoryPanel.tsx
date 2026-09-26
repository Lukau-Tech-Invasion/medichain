import { useCallback, useEffect, useId, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  discardBloodUnit,
  getBloodUnits,
  issueBloodUnit,
  receiveBloodUnit,
  releaseBloodUnit,
  reserveBloodUnit,
  useTranslation,
} from '@medichain/shared';
import type { BloodProductCode, BloodStockSummary, BloodUnit } from '@medichain/shared';

type LoadState = 'loading' | 'ready' | 'error';

const PRODUCTS: BloodProductCode[] = ['PackedRBC', 'FFP', 'Platelets', 'Cryoprecipitate', 'WholeBlood'];
const GROUPS: Array<BloodUnit['abo']> = ['O', 'A', 'B', 'AB'];
const INPUT = 'w-full rounded-md border border-border bg-surface p-2 text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
const BUTTON = 'rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';

/** A caught error as text, or the fallback. */
function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Blood-unit stock: alerts, counts per product and group, every unit, and
 * (for blood-bank staff) receive, reserve, release, issue and discard.
 */
export function BloodInventoryPanel({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>('loading');
  const [units, setUnits] = useState<BloodUnit[]>([]);
  const [summary, setSummary] = useState<BloodStockSummary | null>(null);

  const load = useCallback(async () => {
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const body = await getBloodUnits();
      setUnits(body.units ?? []);
      setSummary(body.summary);
      setState('ready');
    } catch (err) {
      console.error('Blood stock could not be loaded:', err);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-content-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('docBloodInventory.loading')}
      </p>
    );
  }
  if (state === 'error' || !summary) {
    return <p role="alert" className="text-sm text-critical-subtle-fg">{t('docBloodInventory.loadFailed')}</p>;
  }
  return (
    <div className="space-y-6">
      <StockAlerts summary={summary} />
      <StockTable summary={summary} />
      {canManage && <ReceiveForm onReceived={() => void load()} />}
      <UnitList units={units} expiring={summary.expiring_unit_ids} canManage={canManage} onChanged={() => void load()} />
    </div>
  );
}

/** Expiry and low-stock alerts, labelled as default thresholds. */
function StockAlerts({ summary }: { summary: BloodStockSummary }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-lg border border-caution bg-caution-subtle p-4 text-sm text-caution-subtle-fg space-y-1">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {t('docBloodInventory.alertsHeading')}
      </p>
      <p>{t('docBloodInventory.expiringCount', { count: String(summary.expiring_unit_ids.length), days: String(summary.expiry_warning_days) })}</p>
      <p>
        {summary.low_stock_groups.length === 0
          ? t('docBloodInventory.noLowStock')
          : t('docBloodInventory.lowStock', { groups: summary.low_stock_groups.join(', '), min: String(summary.low_stock_units) })}
      </p>
      {summary.thresholds_are_defaults && <p className="text-xs">{t('docBloodInventory.defaultThresholds')}</p>}
    </section>
  );
}

/** Available, in-date units by product and group, or an honest "none". */
function StockTable({ summary }: { summary: BloodStockSummary }) {
  const { t } = useTranslation();
  if (summary.stock.length === 0) return <p className="text-sm text-content-muted">{t('docBloodInventory.noStock')}</p>;
  return (
    <table className="w-full text-sm">
      <caption className="text-left font-medium text-content mb-2">{t('docBloodInventory.stockHeading')}</caption>
      <thead>
        <tr className="text-left text-content-muted">
          <th scope="col">{t('docBloodInventory.product')}</th>
          <th scope="col">{t('docBloodInventory.group')}</th>
          <th scope="col">{t('docBloodInventory.available')}</th>
        </tr>
      </thead>
      <tbody>
        {summary.stock.map((line) => (
          <tr key={`${line.product_type}-${line.abo}-${line.rh}`} className="border-t border-border">
            <td>{line.product_type}</td>
            <td>{line.abo} {line.rh}</td>
            <td>{line.available}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Receive a unit into stock. */
function ReceiveForm({ onReceived }: { onReceived: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const empty = { unit_number: '', product_type: 'PackedRBC' as BloodProductCode, abo: 'O' as BloodUnit['abo'], rh: 'negative' as BloodUnit['rh'], collected_on: '', expires_on: '', location: '' };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await receiveBloodUnit(form);
      setForm(empty);
      onReceived();
    } catch (err) {
      setError(messageOf(err, t('docBloodInventory.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-lg bg-surface shadow p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
      <h3 className="md:col-span-4 font-medium text-content">{t('docBloodInventory.receiveHeading')}</h3>
      <label className="text-sm text-content-secondary" htmlFor={`${id}-number`}>{t('docBloodInventory.unitNumber')}
        <input id={`${id}-number`} required value={form.unit_number} onChange={set('unit_number')} className={INPUT} />
      </label>
      <label className="text-sm text-content-secondary" htmlFor={`${id}-product`}>{t('docBloodInventory.product')}
        <select id={`${id}-product`} value={form.product_type} onChange={set('product_type')} className={INPUT}>
          {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="text-sm text-content-secondary" htmlFor={`${id}-abo`}>{t('docBloodInventory.abo')}
        <select id={`${id}-abo`} value={form.abo} onChange={set('abo')} className={INPUT}>
          {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </label>
      <label className="text-sm text-content-secondary" htmlFor={`${id}-rh`}>{t('docBloodInventory.rh')}
        <select id={`${id}-rh`} value={form.rh} onChange={set('rh')} className={INPUT}>
          <option value="negative">{t('docBloodInventory.rhNegative')}</option>
          <option value="positive">{t('docBloodInventory.rhPositive')}</option>
        </select>
      </label>
      <label className="text-sm text-content-secondary" htmlFor={`${id}-collected`}>{t('docBloodInventory.collectedOn')}
        <input id={`${id}-collected`} type="date" required value={form.collected_on} onChange={set('collected_on')} className={INPUT} />
      </label>
      <label className="text-sm text-content-secondary" htmlFor={`${id}-expires`}>{t('docBloodInventory.expiresOn')}
        <input id={`${id}-expires`} type="date" required value={form.expires_on} onChange={set('expires_on')} className={INPUT} />
      </label>
      <label className="text-sm text-content-secondary md:col-span-2" htmlFor={`${id}-location`}>{t('docBloodInventory.location')}
        <input id={`${id}-location`} required maxLength={120} value={form.location} onChange={set('location')} className={INPUT} />
      </label>
      {error && <p role="alert" className="md:col-span-4 text-sm text-critical-subtle-fg">{error}</p>}
      <div className="md:col-span-4">
        <button type="submit" disabled={busy} className={`${BUTTON} bg-brand text-brand-fg`}>{t('docBloodInventory.receive')}</button>
      </div>
    </form>
  );
}

interface UnitListProps {
  units: BloodUnit[];
  expiring: string[];
  canManage: boolean;
  onChanged: () => void;
}

/** Every unit, soonest expiry first, with the actions its status allows. */
function UnitList({ units, expiring, canManage, onChanged }: UnitListProps) {
  const { t } = useTranslation();
  if (units.length === 0) return <p className="text-sm text-content-muted">{t('docBloodInventory.noUnits')}</p>;
  return (
    <ul className="space-y-2" aria-label={t('docBloodInventory.unitsHeading')}>
      {units.map((unit) => (
        <UnitRow key={unit.id} unit={unit} expiringSoon={expiring.includes(unit.id)} canManage={canManage} onChanged={onChanged} />
      ))}
    </ul>
  );
}

type RowAction = null | 'reserve' | 'issue' | 'discard';

/** One unit: its facts, and for staff the next action it allows. */
function UnitRow({ unit, expiringSoon, canManage, onChanged }: { unit: BloodUnit; expiringSoon: boolean; canManage: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const [action, setAction] = useState<RowAction>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (call: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await call();
      setAction(null);
      onChanged();
    } catch (err) {
      setError(messageOf(err, t('docBloodInventory.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg bg-surface shadow p-3 text-sm space-y-2">
      <p className="text-content">
        <span className="font-medium">{unit.unit_number}</span> · {unit.product_type} · {unit.abo} {unit.rh} · {t(`docBloodInventory.status_${unit.status}`)}
      </p>
      <p className="text-xs text-content-muted">
        {t('docBloodInventory.unitLine', { expires: unit.expires_on, location: unit.location })}
        {unit.reserved_for_patient_id && ` · ${t('docBloodInventory.reservedFor', { patient: unit.reserved_for_patient_id })}`}
      </p>
      {expiringSoon && <p className="text-xs font-medium text-caution-subtle-fg">{t('docBloodInventory.expiringSoon')}</p>}
      {canManage && <UnitActions unit={unit} action={action} busy={busy} onAction={setAction} onRun={run} />}
      {error && <p role="alert" className="text-xs text-critical-subtle-fg">{error}</p>}
    </li>
  );
}

interface UnitActionsProps {
  unit: BloodUnit;
  action: RowAction;
  busy: boolean;
  onAction: (action: RowAction) => void;
  onRun: (call: () => Promise<unknown>) => void;
}

/** The buttons, or the one open action form, for a unit's status. */
function UnitActions({ unit, action, busy, onAction, onRun }: UnitActionsProps) {
  const { t } = useTranslation();
  if (action === 'reserve') {
    return <TwoFieldForm first={t('docBloodInventory.patientId')} second={t('docBloodInventory.crossmatch')} busy={busy} onCancel={() => onAction(null)} onSubmit={(p, x) => onRun(() => reserveBloodUnit(unit.id, p, x))} />;
  }
  if (action === 'issue') {
    return <TwoFieldForm first={t('docBloodInventory.transfusionId')} busy={busy} onCancel={() => onAction(null)} onSubmit={(tx) => onRun(() => issueBloodUnit(unit.id, tx))} />;
  }
  if (action === 'discard') {
    return <TwoFieldForm first={t('docBloodInventory.discardReason')} busy={busy} onCancel={() => onAction(null)} onSubmit={(r) => onRun(() => discardBloodUnit(unit.id, r))} />;
  }
  const button = `${BUTTON} border border-border text-content hover:bg-surface-sunken`;
  return (
    <div className="flex flex-wrap gap-2">
      {unit.status === 'available' && <button type="button" className={button} onClick={() => onAction('reserve')}>{t('docBloodInventory.reserve')}</button>}
      {unit.status === 'reserved' && <button type="button" className={button} onClick={() => onAction('issue')}>{t('docBloodInventory.issue')}</button>}
      {unit.status === 'reserved' && <button type="button" className={button} disabled={busy} onClick={() => onRun(() => releaseBloodUnit(unit.id))}>{t('docBloodInventory.release')}</button>}
      {['available', 'reserved', 'expired'].includes(unit.status) && <button type="button" className={button} onClick={() => onAction('discard')}>{t('docBloodInventory.discard')}</button>}
    </div>
  );
}

interface TwoFieldFormProps {
  first: string;
  second?: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (first: string, second: string) => void;
}

/** One or two labelled text fields with confirm and cancel. */
function TwoFieldForm({ first, second, busy, onCancel, onSubmit }: TwoFieldFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(a, b);
      }}
    >
      <label htmlFor={`${id}-a`} className="text-xs text-content-secondary">{first}
        <input id={`${id}-a`} required value={a} onChange={(e) => setA(e.target.value)} className={INPUT} />
      </label>
      {second && (
        <label htmlFor={`${id}-b`} className="text-xs text-content-secondary">{second}
          <input id={`${id}-b`} required value={b} onChange={(e) => setB(e.target.value)} className={INPUT} />
        </label>
      )}
      <button type="submit" disabled={busy} className={`${BUTTON} bg-brand text-brand-fg`}>{t('docBloodInventory.confirm')}</button>
      <button type="button" onClick={onCancel} className={`${BUTTON} text-content-secondary hover:bg-surface-sunken`}>{t('docBloodInventory.cancel')}</button>
    </form>
  );
}
