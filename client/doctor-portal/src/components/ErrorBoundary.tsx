/* eslint-disable react-refresh/only-export-components --
   A re-export shim, not a component module: there is nothing here for Fast
   Refresh to preserve, and `withErrorBoundary` is a HOC the rule cannot
   distinguish from a stray non-component export. */
/**
 * Re-export of the shared error boundary.
 *
 * The implementation moved to `@medichain/shared` so the patient app gets the
 * same crash containment: it previously had none, and a single render error
 * blanked the entire PWA — including the emergency medical ID. This shim keeps
 * the existing `./components/ErrorBoundary` import path (and its tests) working.
 */
export { ErrorBoundary, withErrorBoundary } from '@medichain/shared';
