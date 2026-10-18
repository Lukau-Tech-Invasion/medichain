/**
 * Recover a tab that outlived a deployment.
 *
 * Every build renames its lazily loaded chunks. A tab opened before a deploy
 * still asks for the old names, the server answers 404, and the screen the
 * clinician clicked into falls into the error boundary. Vite reports that as a
 * `vite:preloadError` event; the answer is to load the current build once.
 *
 * Once per minute at most: if the new build cannot load either, a reload loop
 * would hide the real failure behind a flickering page.
 */
const MARK = 'medichain_stale_chunk_reload_at';
const WINDOW_MS = 60_000;

export function reloadOnStaleChunks(target: Window = window): void {
  target.addEventListener('vite:preloadError', (event) => {
    let last = 0;
    try {
      last = Number(target.sessionStorage.getItem(MARK) ?? 0);
    } catch {
      // No session storage: reload anyway, the window check is best effort.
    }
    if (Date.now() - last < WINDOW_MS) return;
    event.preventDefault();
    try {
      target.sessionStorage.setItem(MARK, String(Date.now()));
    } catch {
      // Nothing to record; the reload still recovers the tab.
    }
    target.location.reload();
  });
}
