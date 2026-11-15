# BFA-003 — Live Docker image cannot provide doctor or nurse browser test access

## Status

Open. Reproduced on 2026-08-19 against the local synthetic Docker stack.

## Evidence

## Impact

Doctor and nurse functionality cannot be tested in the browser in the currently
running stack. Therefore no claim of role-workflow completeness is supportable.

## Fix strategy

Add a dedicated, non-production `browser-test` Compose/Vite profile. It must:

1. seed fixed synthetic Doctor, Nurse, and Patient identities;
2. authenticate those fixtures using a bounded test-only mechanism;
3. expose the mechanism only in the isolated profile, never the normal image;
4. make the fixture links and expected data visible to the test runbook;
5. fail fast when a fixture's role, patient link, or storage backend is wrong; and
6. delete or reset only the isolated test database after the run.

## Acceptance criteria

- A fresh isolated browser-test stack presents clearly labelled synthetic role
  entry controls for Doctor, Nurse, and Patient.
- Each control results in a backend-verified role session, not a client-only role.
- The normal Docker/production image exposes none of those controls.
- Browser tests can sign in as all three roles and verify a role-specific endpoint.
- A documented teardown resets only the isolated synthetic data.
