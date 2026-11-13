/**
 * The unit and crew a run is started under, so the receiving hospital can see
 * who is bringing the patient ("Unit 14 (P. Mokoena)").
 *
 * They stay the same for a whole shift, so the device remembers what this
 * crew member last entered -- staff details only, never anything about a
 * patient. Nothing is filled in that nobody typed (rule 9).
 */
import type { CreateEmsRunBody } from '@medichain/shared';

export interface CrewDetails {
  unit: string;
  /** Names as typed, separated by commas. */
  crew: string;
}

const EMPTY: CrewDetails = { unit: '', crew: '' };
/** The server accepts at most ten names. */
const MAX_CREW = 10;

const key = (userId: string | undefined) => `medichain:ems-crew:${userId ?? 'anonymous'}`;

export function readCrewDetails(userId: string | undefined): CrewDetails {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<CrewDetails>;
    return {
      unit: typeof parsed.unit === 'string' ? parsed.unit : '',
      crew: typeof parsed.crew === 'string' ? parsed.crew : '',
    };
  } catch {
    return EMPTY;
  }
}

export function saveCrewDetails(userId: string | undefined, details: CrewDetails): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(details));
  } catch {
    // No storage: the crew types it again next run.
  }
}

/** The part of a new run's body these fields supply; absent when blank. */
export function crewBody(details: CrewDetails): Pick<CreateEmsRunBody, 'unit_number' | 'crew'> {
  const unit = details.unit.trim();
  const crew = details.crew.split(',').map((c) => c.trim()).filter(Boolean).slice(0, MAX_CREW);
  return { ...(unit ? { unit_number: unit } : {}), ...(crew.length ? { crew } : {}) };
}
