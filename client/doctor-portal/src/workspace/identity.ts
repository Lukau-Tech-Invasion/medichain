/**
 * How a person is named on screen when a clinician must match them to a
 * record: initials for the avatar, age in whole years from the date of birth.
 * Shared by the workspace banner and the incoming-ambulance board.
 */

/** Completed years since `dateOfBirth`; null when it is missing or unreadable. */
export function ageInYears(dateOfBirth: string | null | undefined, now = new Date()): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  let years = now.getFullYear() - born.getFullYear();
  const beforeBirthday = now.getMonth() < born.getMonth()
    || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) years -= 1;
  return years >= 0 ? years : null;
}

/** Up to two initials; "?" when there is no name to take them from. */
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}
