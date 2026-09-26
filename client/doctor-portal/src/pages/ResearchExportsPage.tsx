import { useCallback, useEffect, useId, useState } from 'react';
import { Download, FlaskConical, Loader2 } from 'lucide-react';
import {
  approveResearchExport,
  executeResearchExport,
  listResearchExports,
  proposeResearchExport,
  saveBlob,
  useTranslation,
} from '@medichain/shared';
import type { ResearchExportRun, ResearchRecord } from '@medichain/shared';
import { useAuthStore } from '../store/authStore';

/** Shortest purpose the API accepts, in characters. */
const MIN_PURPOSE_CHARS = 20;
/** Longest purpose the API accepts, in characters. */
const MAX_PURPOSE_CHARS = 500;

type LoadState = 'loading' | 'ready' | 'error';

/** The released records as CSV, one row per record. */
function toCsv(records: ResearchRecord[]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = records.map((r) => [r.pseudonym, r.age_band, r.sex, r.conditions.join('; ')].map(quote).join(','));
  return ['pseudonym,age_band,sex,conditions', ...rows].join('\n');
}

/**
 * Research exports (administrators). Propose with a stated purpose; two other
 * administrators approve; then it runs once and releases only de-identified
 * records of patients with active research consent. The released file is
 * offered once, at run time: nothing identifiable is kept to re-download.
 */
export default function ResearchExportsPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>('loading');
  const [runs, setRuns] = useState<ResearchExportRun[]>([]);
  const [configured, setConfigured] = useState(true);
  // Released records live here, not in a card: the list reloads after a run,
  // and the dataset is offered only once, so a reload must not drop it.
  const [released, setReleased] = useState<Record<string, ResearchRecord[]>>({});

  const load = useCallback(async () => {
    // A refresh keeps the current list on screen; only the first load shows
    // the loading state.
    setState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    try {
      const body = await listResearchExports();
      setRuns(body.exports ?? []);
      setConfigured(body.configured);
      setState('ready');
    } catch (err) {
      console.error('Research exports could not be loaded:', err);
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-content flex items-center">
        <FlaskConical className="h-8 w-8 mr-3" aria-hidden="true" />
        {t('docResearch.title')}
      </h1>
      <p className="mt-2 mb-6 text-content-muted">{t('docResearch.subtitle')}</p>
      {!configured && (
        <p role="status" className="mb-6 rounded-lg border border-caution bg-caution-subtle p-3 text-sm text-caution-subtle-fg">
          {t('docResearch.notConfigured')}
        </p>
      )}
      <ProposeForm onProposed={() => void load()} />
      <RunList
        state={state}
        runs={runs}
        released={released}
        onReleased={(id, records) => setReleased((prev) => ({ ...prev, [id]: records }))}
        onChanged={() => void load()}
      />
    </div>
  );
}

/** A purpose statement and "Propose export". */
function ProposeForm({ onProposed }: { onProposed: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const length = purpose.trim().length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await proposeResearchExport(purpose);
      setPurpose('');
      onProposed();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('docResearch.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mb-8 bg-surface shadow rounded-lg p-6 space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-content">{t('docResearch.purposeLabel')}</label>
      <textarea
        id={id}
        value={purpose}
        maxLength={MAX_PURPOSE_CHARS}
        onChange={(e) => setPurpose(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-border bg-surface p-2 text-sm text-content focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      />
      <p className="text-xs text-content-muted">{t('docResearch.purposeHint', { min: String(MIN_PURPOSE_CHARS) })}</p>
      {error && <p role="alert" className="text-sm text-critical-subtle-fg">{error}</p>}
      <button
        type="submit"
        disabled={busy || length < MIN_PURPOSE_CHARS}
        className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {t('docResearch.propose')}
      </button>
    </form>
  );
}

interface RunListProps {
  state: LoadState;
  runs: ResearchExportRun[];
  released: Record<string, ResearchRecord[]>;
  onReleased: (id: string, records: ResearchRecord[]) => void;
  onChanged: () => void;
}

/** Loading, error, empty and list states. */
function RunList({ state, runs, released, onReleased, onChanged }: RunListProps) {
  const { t } = useTranslation();
  if (state === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-content-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('docResearch.loading')}
      </p>
    );
  }
  if (state === 'error') return <p role="alert" className="text-sm text-critical-subtle-fg">{t('docResearch.loadFailed')}</p>;
  if (runs.length === 0) return <p className="text-sm text-content-muted">{t('docResearch.none')}</p>;
  return (
    <ul className="space-y-4">
      {runs.map((run) => (
        <RunCard
          key={run.id}
          run={run}
          released={released[run.id] ?? null}
          onReleased={(records) => onReleased(run.id, records)}
          onChanged={onChanged}
        />
      ))}
    </ul>
  );
}

/** One export: purpose, approvals, and the action its state allows. */
interface RunCardProps {
  run: ResearchExportRun;
  released: ResearchRecord[] | null;
  onReleased: (records: ResearchRecord[]) => void;
  onChanged: () => void;
}

function RunCard({ run, released, onReleased, onChanged }: RunCardProps) {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = user?.walletAddress === run.proposed_by;

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t('docResearch.actionFailed'));
    } finally {
      setBusy(false);
    }
  };
  const execute = () =>
    act(async () => {
      const body = await executeResearchExport(run.id);
      onReleased(body.records);
    });

  return (
    <li className="bg-surface shadow rounded-lg p-4 space-y-2">
      <p className="text-sm text-content">{run.purpose}</p>
      <p className="text-xs text-content-muted">
        {t('docResearch.statusLine', {
          status: run.status,
          approvals: String(run.approved_by.length),
          required: String(run.required_approvals),
        })}
      </p>
      {run.status === 'executed' && (
        <p className="text-xs text-content-muted">
          {t('docResearch.executedLine', { included: String(run.included_count ?? 0), withheld: String(run.withheld_count ?? 0) })}
        </p>
      )}
      {run.status === 'proposed' && !mine && (
        <button type="button" disabled={busy} onClick={() => void act(() => approveResearchExport(run.id))} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60">
          {t('docResearch.approve')}
        </button>
      )}
      {run.status === 'proposed' && mine && <p className="text-xs text-content-muted">{t('docResearch.awaitingOthers')}</p>}
      {run.status === 'approved' && (
        <button type="button" disabled={busy} onClick={() => void execute()} className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-60">
          {t('docResearch.run')}
        </button>
      )}
      {released && (
        <button type="button" onClick={() => saveBlob(new Blob([toCsv(released)], { type: 'text/csv' }), `${run.id}.csv`)} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-content hover:bg-surface-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <Download className="h-4 w-4" aria-hidden="true" />
          {t('docResearch.downloadOnce', { count: String(released.length) })}
        </button>
      )}
      {error && <p role="alert" className="text-sm text-critical-subtle-fg">{error}</p>}
    </li>
  );
}
