# MediChain API

The Actix-web API serves clinical workflows, FHIR endpoints, patient access
history, and account authentication. Run it from the repository root with
`cargo run -p medichain-api` after configuring a development PostgreSQL database.

Clients sign in through `POST /api/auth/login` using a login ID, password proof,
and an authenticator code if enrolled. Protected requests use
`Authorization: Bearer <access-token>`. A verified session ID is required;
caller-supplied identity headers do not establish a user identity.

Patient registration issues a one-time activation code. An administrator can
register staff and issue a code or reset an existing credential. The recipient
redeems it through `POST /api/auth/credentials/redeem`, then chooses a password.
Demo fixture credentials are available only with both development and demo mode
enabled; see [developer authentication guidance](../docs/DEV_AUTH.md).
