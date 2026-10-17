import { useCallback, useEffect, useRef, useState } from 'react';
import { getNurseDashboard, getNurseTasks, type NurseDashboardResponse, type NursingOrderTask } from '@medichain/shared';

export interface NurseRead<T> {
  data: T | null;
  status: 'loading' | 'ready' | 'failed';
  reload: () => Promise<void>;
}

/** Reject incomplete dashboard envelopes rather than converting absent collections into empty ones. */
async function readDashboard(): Promise<NurseDashboardResponse> {
  const data = await getNurseDashboard();
  if (!data || !Array.isArray(data.patients?.list) || !data.tasks ||
      ![data.vitals_needing_attention, data.fall_risk_patients, data.io_records, data.medication_records].every(Array.isArray)) {
    throw new Error('Incomplete nursing dashboard response');
  }
  return data;
}

/** An absent order list is not a confirmed empty order book. */
async function readOrders(): Promise<NursingOrderTask[]> {
  const data = await getNurseTasks();
  if (!data.success || !Array.isArray(data.tasks)) throw new Error('Incomplete nursing orders response');
  return data.tasks;
}

/** Load one account-scoped resource and invalidate obsolete reads on retry, account change and unmount. */
function useNurseRead<T>(load: () => Promise<T>, owner: string): NurseRead<T> {
  const generation = useRef(0);
  const [state, setState] = useState<{ owner: string; data: T | null; status: NurseRead<T>['status'] }>({ owner, data: null, status: 'loading' });
  const reload = useCallback(async () => {
    if (!owner) return;
    const request = ++generation.current;
    setState({ owner, data: null, status: 'loading' });
    try {
      const data = await load();
      if (request === generation.current) setState({ owner, data, status: 'ready' });
    } catch (error) {
      console.error('Nursing dashboard resource read failed:', error);
      if (request === generation.current) setState({ owner, data: null, status: 'failed' });
    }
  }, [load, owner]);
  useEffect(() => { void reload(); return () => { generation.current += 1; }; }, [reload]);
  return { ...(state.owner === owner ? state : { data: null, status: 'loading' as const }), reload };
}

/** Keep dashboard and nursing-order success, failure and retries independent. */
export function useNurseDashboardReads(owner: string) {
  return { dashboard: useNurseRead(readDashboard, owner), orders: useNurseRead(readOrders, owner) };
}
