/**
 * MediChain API endpoints: Helpers shared by more than one endpoint module.
 */


// ============================================================================
// File bytes
// ============================================================================

/**
 * A file's bytes. `FileReader` rather than `Blob.arrayBuffer()`, which older
 * Safari (before 14) and some embedded webviews do not provide.
 */
export function readFileBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}

// ============================================================================
// List envelopes
// ============================================================================

export interface ListResponse<T> {
  success: boolean;
  total: number;
  items: T[];
}

/** Wrap a bare-array admin-list response in the `{success, total, items}` shape. */
export function wrapListResponse<T>(items: T[]): ListResponse<T> {
  return { success: true, total: items.length, items };
}

// ============================================================================
// Reading back a stored record
// ============================================================================

// ---------------------------------------------------------------------------
// Reading back a record the screen itself wrote
// ---------------------------------------------------------------------------

/**
 * A stored clinical record, in the shape the screen that wrote it uses.
 *
 * Several procedure handlers (`create_intubation`, `create_splint`,
 * `create_burn`, `create_anesthesia`) persist the **whole submission** in the
 * record's `data` blob alongside a queryable projection in typed columns. The
 * blob is therefore already in the screen's own shape -- its camelCase names,
 * its nested objects -- and is the faithful thing to render.
 *
 * Two things the blob cannot carry, which this overlays from the typed row:
 *
 *   * the **id**, which is server-assigned, so a screen echoing its own
 *     submission has nothing to open a detail view with; and
 *   * any column the server stamped rather than accepted -- the performing
 *     clinician, for instance. The blob records what the client *claimed*; the
 *     column records who was actually signed in, and the second is the one to
 *     show.
 *
 * Pass `authoritative` as { screenField: entityColumn } for that second case.
 *
 * # Why this exists
 *
 * Every one of those pages kept its list in local React state --
 * `setRecords([newRecord, ...records])` -- and never read anything back. The
 * screen showed what you typed this session and emptied on reload, while the
 * record sat in the database. This is the other half of the fix.
 */
export function fromStoredRecord<T>(
  raw: Record<string, unknown>,
  authoritative: Record<string, string> = {}
): T {
  const blob = (raw.data ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...blob };

  // The server-assigned primary key always wins over anything in the blob.
  if (raw.id !== undefined && raw.id !== null) merged.id = raw.id;

  for (const [screenField, column] of Object.entries(authoritative)) {
    const value = raw[column];
    if (value !== undefined && value !== null && value !== '') {
      merged[screenField] = value;
    }
  }
  return merged as T;
}

/**
 * Pull the row array out of whatever envelope a list endpoint used.
 *
 * These endpoints are not consistent with each other -- some return a bare
 * array, some `{ records: [...] }`, some `{ data: [...] }` -- and a screen that
 * guesses wrong renders an empty list rather than an error, which is the
 * failure mode hardest to notice.
 */
export function rowsOfResponse(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === 'object') {
    const envelope = body as Record<string, unknown>;
    for (const key of ['records', 'data', 'items', 'assessments', 'repairs']) {
      if (Array.isArray(envelope[key])) return envelope[key] as Record<string, unknown>[];
    }
  }
  return [];
}
