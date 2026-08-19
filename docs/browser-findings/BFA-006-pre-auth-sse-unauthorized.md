# BFA-006 — Patient portal attempts protected SSE before authentication

## Status

Candidate functional defect. Reproduced on 2026-08-19.

## Evidence

On the patient login journey, the browser console reports `SSE connection
failed: 401 Unauthorized`. The error occurs before/around authentication and
remains in the captured console after successful wallet entry.

## Fix strategy

Make the event-stream hook wait until a valid authenticated session is
available. On session creation, establish the stream with the applicable
credentials; on logout/expiry, close it cleanly. Treat an expected unauthenticated
state as an idle state rather than a console error. Preserve a visible reconnect
state for genuine post-auth failures.

## Acceptance criteria

- The login page makes no protected SSE request before a session exists.
- Exactly one authenticated stream connects after sign-in.
- Logout closes the stream and later navigation produces no 401 console error.
- A browser test covers login, reconnect, expiry, and logout.
