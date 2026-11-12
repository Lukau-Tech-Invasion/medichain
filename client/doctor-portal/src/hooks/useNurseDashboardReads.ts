import { getNurseDashboard, getNurseTasks, useAsyncRead, type NurseDashboardResponse, type NursingOrderTask } from '@medichain/shared';

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

/** Load one account-scoped resource; obsolete reads are dropped on retry, account change and unmount. */
function useNurseRead<T>(load: () => Promise<T>, owner: string): NurseRead<T> {
  const read = useAsyncRead(owner, async () => {
    try {
      return await load();
    } catch (error) {
      console.error('Nursing dashboard resource read failed:', error);
      throw error;
    }
  });
  // No account yet is still "loading" to this screen: it has nothing to show.
  return { data: read.data, status: read.status === 'idle' ? 'loading' : read.status, reload: read.reload };
}

/** Keep dashboard and nursing-order success, failure and retries independent. */
export function useNurseDashboardReads(owner: string) {
  return { dashboard: useNurseRead(readDashboard, owner), orders: useNurseRead(readOrders, owner) };
}
