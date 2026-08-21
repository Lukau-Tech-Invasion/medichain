/**
 * Total lookups for values that arrive from the API.
 *
 * # The failure this prevents
 *
 * Pages routinely map a status onto an icon or a set of CSS classes:
 *
 * ```ts
 * const icons = { requested: Clock, completed: CheckCircle };
 * return icons[status];          // undefined for anything else
 * ```
 *
 * TypeScript says that is total, because `status` is a union. The data does
 * not: the value comes off the wire and is asserted with `as`, never
 * validated. A status the backend adds later — or an older record written
 * before the union was narrowed — yields `undefined`.
 *
 * For a CSS-class map that is a cosmetic bug. For an **icon** map it is not:
 * rendering `undefined` as a JSX element throws "Element type is invalid",
 * React unmounts the tree, and the clinician gets a blank page. A blank consult
 * list is indistinguishable from "no consults" — the exact failure mode this
 * codebase has been bitten by repeatedly.
 *
 * These helpers make the lookup total at the boundary, so an unrecognised value
 * degrades to a neutral presentation instead of removing the page.
 */

/**
 * Look `key` up in `map`, falling back when it is missing.
 *
 * Use for class names, labels, colours — anything where an unknown value should
 * render neutrally rather than break layout.
 */
export function lookupOr<T>(
  map: Record<string, T>,
  key: string | null | undefined,
  fallback: T
): T {
  if (key == null) return fallback;
  // `Object.prototype.hasOwnProperty` rather than a truthiness check: a
  // legitimately falsy mapped value (0, '') must not be replaced by the
  // fallback, and a key like "constructor" must not resolve off the prototype.
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

/**
 * Look a component up in `map`, falling back when it is missing.
 *
 * Distinct from {@link lookupOr} only in intent and in the guarantee it
 * documents: the result is always renderable, so an unmapped value can never
 * unmount the page. `fallback` is required — there is no sensible default
 * icon, and defaulting to `null` would silently drop the indicator that the
 * surrounding layout is built around.
 */
export function componentOr<T>(
  map: Record<string, T>,
  key: string | null | undefined,
  fallback: T
): T {
  return lookupOr(map, key, fallback);
}
