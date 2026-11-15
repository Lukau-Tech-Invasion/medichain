/**
 * What a nurse has done on the IV site page and not yet saved, kept apart from
 * the sites the server returned.
 *
 * The page used to hold both in one list, so its draft could not tell unsaved
 * work from a list that had just loaded, and a restored draft would have
 * replaced the stored sites with a copy taken whenever the draft was written.
 * The draft is now only these staged edits, laid over a fresh load.
 */

/** The parts of a site the staged edits touch. */
export interface StageableSite<A> {
  id: string;
  isActive: boolean;
  assessments: A[];
  discontinuedAt?: string;
  discontinuedBy?: string;
  discontinuedReason?: string;
}

export interface Discontinuation {
  at: string;
  by: string;
  reason: string;
}

export interface StagedEdits<S, A> {
  /** Sites added on this screen; each carries a local `draft-` key. */
  added: S[];
  /** Assessments documented here, by the id of the site they belong to. */
  assessments: Record<string, A[]>;
  /** Sites taken out here, by id. */
  discontinued: Record<string, Discontinuation>;
}

export function noStagedEdits<S, A>(): StagedEdits<S, A> {
  return { added: [], assessments: {}, discontinued: {} };
}

/** The sites as the screen shows them: stored, then added, with every staged edit applied. */
export function applyStaged<A, S extends StageableSite<A>>(stored: S[], staged: StagedEdits<S, A>): S[] {
  return [...stored, ...staged.added].map((site) => {
    const assessments = staged.assessments[site.id];
    const off = staged.discontinued[site.id];
    if (!assessments && !off) return site;
    return {
      ...site,
      assessments: assessments ? [...site.assessments, ...assessments] : site.assessments,
      ...(off ? { isActive: false, discontinuedAt: off.at, discontinuedBy: off.by, discontinuedReason: off.reason } : {}),
    };
  });
}

/** The next local key for an added site; unique among those already staged. */
export function nextDraftKey<S extends { id: string }>(added: S[]): string {
  const used = new Set(added.map((site) => site.id));
  let n = added.length + 1;
  // Bounded: at most `added.length` keys can be taken.
  while (used.has(`draft-${n}`) && n <= 2 * added.length + 1) n += 1;
  return `draft-${n}`;
}
