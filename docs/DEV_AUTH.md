# Developer authentication and demo fixtures

MediChain uses account IDs internally and a login ID with a password proof for
sign-in. Patients receive a one-time activation code at registration; staff
receive one from an administrator. Redeem the code at
`POST /api/auth/credentials/redeem` to choose a password, then sign in at
`POST /api/auth/login`. If the account has TOTP enabled, include the code.

Send the access token as `Authorization: Bearer <access-token>` on protected
requests. The API binds the token to a durable, revocable login session.

For synthetic browser fixtures, use the repository's
`scripts/seed-browser-test-fixtures.ts` with an isolated development database.
`GET /api/auth/demo-credentials` is available only when both
`MEDICHAIN_DEV_MODE=true` and `IS_DEMO=true`; it returns only the named fixture
accounts. It is not an account-creation or authentication bypass.

Never point fixture scripts at a production database. Verify the normal login,
patient access, and logout flow with an isolated database before using the demo.
