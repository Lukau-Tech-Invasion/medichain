/**
 * The forms a clinician opened last, for the workspace rail's "Recent" group
 * (mockup c4). Form names only -- which screen, never which patient or what was
 * in it -- so it may outlive the tab; per account, and it fails quietly where
 * storage is blocked.
 */
const KEY = 'medichain:recent-forms';
const KEEP = 8;

function keyFor(userId: string | undefined): string {
  return `${KEY}:${userId ?? '-'}`;
}

export function recentForms(userId: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyFor(userId)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberForm(userId: string | undefined, formId: string): void {
  try {
    const next = [formId, ...recentForms(userId).filter((f) => f !== formId)].slice(0, KEEP);
    localStorage.setItem(keyFor(userId), JSON.stringify(next));
  } catch {
    // Storage blocked: the rail simply has no "Recent" group.
  }
}
