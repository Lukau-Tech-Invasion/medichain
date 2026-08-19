# BFA-008 — Running patient image is stale relative to the checked-in booking flow

## Status

Open. Reproduced on 2026-08-19.

## Evidence

The running `/patient/appointments` screen presents a disabled `Book New` tile
and an enabled `Book an Appointment` control. Clicking the enabled control did
not reveal a booking form or change visible state.

The current `client/patient-app/src/pages/AppointmentsPage.tsx` instead defines
an enabled `Book New` control wired to `openBooking()` and conditionally renders
a provider/date/slot/reason booking form. The live DOM does not match this
source behavior. The browser test was conducted against the already-running
image; it must therefore be treated as runtime evidence for that image, not
verification of current source.

## Impact

A valid source-level implementation can remain unavailable to users, and
browser testing of the running stack can produce false conclusions about the
checked-out code. Appointment self-service cannot be verified in the present
runtime.

## Fix strategy

Use immutable image/version metadata and a deployment preflight that compares
the image revision with the intended Git revision. Rebuild the frontend image
from the selected commit, restart only the approved local test stack, and
capture the resulting image digest and `/doctor/`/`/patient/` asset hashes in
the browser-test ledger. Add a smoke assertion that the `Book New` control
opens the current booking form.

## Acceptance criteria

- The running frontend declares its source revision or image digest visibly or
  through a documented health endpoint.
- The browser-test runbook records that revision before each campaign.
- The current appointment booking form opens from the visible `Book New` control.
- The form loads providers and slots, validates required fields, submits a
  synthetic appointment, and reads its pending-provider state back.
