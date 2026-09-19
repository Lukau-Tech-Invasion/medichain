# ADR-0009: keyed blind index for patient-name search

## Status

Accepted — 2026-09-17.

## Context

Patient names are encrypted at rest. Loading a fixed, broad roster and
filtering it in a browser made patients after the first 1,000 rows invisible,
unnecessarily decrypted profiles, and offered no reliable name lookup.

## Decision

Each write normalizes a patient's full name into distinct Unicode
alphanumeric tokens, case-folds them, and stores a domain-separated keyed
SHA3-256 digest of each token in `patients.name_search_tokens`. The key is
`PATIENT_SEARCH_INDEX_KEY`; it is separate from identity, signing, and
encryption keys and is required outside explicit demo mode. PostgreSQL uses a
partial GIN index for active rows and `@>` equality-token search. The API is
`GET /api/patients?q=<name-or-identifier>` and uses keyset pagination ordered
by `updated_at DESC, id ASC`.

The encrypted profile and encrypted first/last-name fields remain authoritative
for plaintext. The blind-index tokens are never serialized to clients.

## Consequences

This deliberately supports whole-token equality only: `Ama`, `Mensah`, and
`Ama Mensah` work; arbitrary substrings and prefixes do not. Prefix/ngram
indexes would reveal more name structure and frequency information. Like every
deterministic blind index, this construction leaks equality and token frequency
to a database reader; it is not searchable encryption that hides access
patterns.

Existing rows have an empty index after migration because SQL cannot decrypt
application-encrypted data. **Amended 2026-09-19:** the API now fills them
itself. `patient_name_index::backfill_missing_name_index` runs once at startup,
pages through rows whose `name_search_tokens` is empty in id order, decrypts
each profile with the keyring and stores only the keyed tokens. It is
idempotent, bounded (`MAX_BACKFILL_BATCHES`), does not touch `updated_at` (the
roster is ordered by it), and logs counts only — indexed, undecryptable, and
names with no indexable word. A row this keyring cannot open stays unindexed and
is counted; it is equally absent from the roster.

Rotating `PATIENT_SEARCH_INDEX_KEY` still requires reindexing every patient
before retiring the old key, and the backfill does **not** do that: it only
fills empty rows. No key version is stored in this first schema because one
active index key is enforced.

Identifiers match exactly, never as substrings (amended 2026-09-19). A query
finds a patient when it equals their record ID or health ID (case-insensitive),
their wallet address, or a national ID — compared through
`hash_national_id` — or when every name token in it is one of theirs. The first
implementation matched `ILIKE '%query%'` against the national-ID digest and the
wallet address; a hex digest contains `ed`, `ab` or `abebe` by chance, so a
short name returned unrelated patients in the picker a clinician uses to choose
whose record to write into. Both backends share
`repositories::patient_search::PatientSearchCriteria`.

## Alternatives rejected

- Plaintext normalized names: unacceptable ePHI disclosure at rest.
- Deterministic encryption of full names: leaks equality for the full value and
  does not support independent first/last-name lookup.
- Client-side filtering: cannot serve a complete register and transfers broad
  unnecessary ePHI to clients.
