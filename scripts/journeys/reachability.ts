/**
 * Every screen a role's navigation offers, answered by the server for that role.
 *
 * # Why this is separate from the six journeys
 *
 * The journeys walk one story per role and prove the work completes. This
 * proves something narrower and just as easy to get wrong: that a screen the
 * navigation offers is a screen that account can actually use.
 *
 * On 2026-09-10 seven pages were routed in `App.tsx`, fully built, and offered
 * by **nobody's** navigation — `/messages`, `/telehealth`, `/pathology`,
 * `/immunization`, `/family-history`, `/nursing-care-plan` and
 * `/emergency-protocols`. Reachable by typing a URL and no other way. The worst
 * of them is the emergency protocol set: a page nobody opens except during an
 * emergency, hidden behind a URL nobody has memorised.
 *
 * Putting them in the navigation is half the fix. The other half is that the
 * endpoint behind each one answers for the role now being offered it — because
 * a screen that renders its controls and then fails every one of them on submit
 * is still the wrong answer to give a clinician. `roles.spec.ts` makes the
 * first half a browser assertion; this makes the second half an API one.
 */

import { http, rowsOf, type Journal, type Session, type Manifest } from '../lib/journey';

/** A screen, and the endpoint it cannot render without. */
interface Screen {
  route: string;
  path: string;
}

/**
 * What each role's newly-offered screens need.
 *
 * Only the screens added on 2026-09-10 are listed. The rest of each role's
 * navigation is covered by that role's own journey, which drives the work
 * rather than only the read.
 */
const SCREENS: Record<string, Screen[]> = {
  doctor: [
    { route: '/messages', path: '/messages?folder=all' },
    { route: '/telehealth', path: '/telehealth/sessions' },
    { route: '/pathology', path: '/platform/list/pathology' },
    { route: '/family-history', path: '/patients?limit=1' },
  ],
  nurse: [
    { route: '/messages', path: '/messages?folder=all' },
    { route: '/immunization', path: '/platform/list/immunizations' },
    { route: '/nursing-care-plan', path: '/emergency/care-plan/list' },
  ],
  labtech: [
    { route: '/messages', path: '/messages?folder=all' },
    { route: '/pathology', path: '/platform/list/pathology' },
  ],
  pharmacist: [{ route: '/messages', path: '/messages?folder=all' }],
};

export async function reachabilityJourney(
  j: Journal,
  sessions: Record<string, Session>,
  _m: Manifest
): Promise<void> {
  j.journey('Every screen a role is offered, answered for that role');

  for (const [role, screens] of Object.entries(SCREENS)) {
    const session = sessions[role];
    if (!session) {
      for (const screen of screens) {
        j.skip(`${role} can open ${screen.route}`, `no ${role} session`);
      }
      continue;
    }

    for (const screen of screens) {
      const response = await http('GET', screen.path, { token: session.token });
      // 200 is the bar. A 403 means the navigation offers a screen the server
      // refuses; a 404 means it offers one that does not exist. Both are the
      // same defect from the clinician's side: a menu entry that does nothing.
      j.status(
        `${role} can open ${screen.route}`,
        response.status,
        200,
        { endpoint: screen.path, ...response.json }
      );
      // And it answers with a collection rather than an error document, so a
      // page that maps over the result is not mapping over a message.
      if (response.status === 200) {
        j.record(
          `${role}'s ${screen.route} receives a list it can render`,
          Array.isArray(rowsOf(response.json)) ,
          `the screen renders a list; the endpoint answered ` +
            `${JSON.stringify(response.json).slice(0, 200)}`
        );
      } else {
        j.skip(`${role}'s ${screen.route} receives a list it can render`, 'the screen was refused');
      }
    }
  }
}
