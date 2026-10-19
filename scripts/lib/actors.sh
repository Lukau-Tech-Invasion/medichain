#!/usr/bin/env bash
# Signed-in actors for the shell harnesses. SOURCE this file; do not run it.
#
# A harness that needs several people acting (an administrator, a doctor, a
# patient) registers or activates each account, signs in the way a portal does
# (POST /api/auth/login with a proof derived from the password), and keeps the
# bearer token under a short KEY. `code METHOD PATH BODY KEY` then sends that
# actor's token, and `uid KEY` is the account's user id (`users.id`, the value
# every actor column holds). There is no identity header: a request is either
# carrying a token the API issued or it is anonymous, and an unknown KEY sends
# something that is not a token, which the API must refuse.
#
# The caller defines BASE (the API origin) before sourcing, then calls
# `actors_init`. State lives in files, not variables, because the helpers are
# routinely called inside `$(...)` and a variable set there is lost.
#
# Provides: actors_init, idem_args, proof, tok_of, uid, store_actor, login_as,
# redeem_as, act_code, provision_patient, code, body, jget.

ACTORS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYN_PASSWORD="${SYN_PASSWORD:-SyntheticE2E!2026}"

actors_init() {
  ACTOR_DIR=$(mktemp -d)
  trap 'rm -rf "$ACTOR_DIR"' EXIT
}

# idem_args METHOD — the Idempotency-Key header, for mutating methods only.
#
# `api/src/middleware/idempotency.rs` refuses any keyed-subject mutation that
# arrives without one (409 IDEMPOTENCY_KEY_REQUIRED). This harness predates
# that middleware, so every POST/PUT/PATCH/DELETE it made was being refused —
# which is what failed hosted CI, and it is the third caller class broken by
# the same change, after the fixture seeder and thirty raw-fetch call sites in
# the portals. A middleware that adds a required header has to migrate its
# callers, and this one was landed without doing so.
#
# A fresh key per call is right here: each assertion is a distinct intent, and
# reusing one across two different requests would be answered
# IDEMPOTENCY_KEY_REUSED, since the key is bound to a request digest.
idem_args() {
  case "$1" in
    POST|PUT|PATCH|DELETE)
      printf '%s\n%s\n' '-H' "Idempotency-Key: $(python -c 'import uuid;print(uuid.uuid4())')"
      ;;
  esac
}

# proof LOGIN_ID PASSWORD — the auth proof the portals derive from a password.
proof() { python "$ACTORS_LIB_DIR/auth_proof.py" "$1" "$2"; }

# tok_of KEY — the bearer token of a signed-in actor. An unknown key yields a
# value that is not a token, so it is refused like any forged credential.
tok_of() {
  if [ -f "$ACTOR_DIR/$1.token" ]; then cat "$ACTOR_DIR/$1.token"; else printf 'not-a-token-%s' "$1"; fi
}
# uid KEY — the user id (`users.id`) of a signed-in actor.
uid() { cat "$ACTOR_DIR/$1.uid" 2>/dev/null; }

# store_actor KEY — keep the token and user id from the sign-in or redeem
# answer currently in /tmp/mc_body. Prints nothing; returns 1 when there is none.
store_actor() {
  local t u
  t=$(jget access_token); u=$(jget user user_id)
  [ -n "$t" ] && [ -n "$u" ] || return 1
  printf '%s' "$t" > "$ACTOR_DIR/$1.token"
  printf '%s' "$u" > "$ACTOR_DIR/$1.uid"
}

# login_as KEY LOGIN_ID [PASSWORD] — POST /api/auth/login, exactly as a portal
# sends it. Echoes the HTTP status.
login_as() {
  local key="$1" lid="$2" pw="${3:-$SYN_PASSWORD}" c
  c=$(code POST /api/auth/login "$(python -c '
import json, sys
print(json.dumps({"identifier": sys.argv[1], "auth_proof": sys.argv[2]}))' "$lid" "$(proof "$lid" "$pw")")")
  [ "$c" = "200" ] && store_actor "$key" && remember_credentials "$key" "$lid" "$pw"
  printf '%s' "$c"
}

# redeem_as KEY IDENTIFIER CODE LOGIN_ID [USERNAME] — POST
# /api/auth/credentials/redeem with the password (setting one is the only time
# it travels; the server checks it and derives the proof). LOGIN_ID is the
# login the account will carry: the employee id for staff, the chosen username
# for a patient. Echoes the HTTP status.
redeem_as() {
  local key="$1" ident="$2" cd_="$3" lid="$4" uname="${5:-}" c
  c=$(code POST /api/auth/credentials/redeem "$(python -c '
import json, sys
b = {"identifier": sys.argv[1], "code": sys.argv[2], "password": sys.argv[3]}
if sys.argv[4]:
    b["username"] = sys.argv[4]
print(json.dumps(b))' "$ident" "$cd_" "$SYN_PASSWORD" "$uname")")
  [ "$c" = "200" ] && store_actor "$key" && remember_credentials "$key" "$lid" "$SYN_PASSWORD"
  printf '%s' "$c"
}

# act_code — the activation code in the registration answer in /tmp/mc_body.
act_code() {
  body | python -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    raise SystemExit
a = d.get("activation") or {}
print(a.get("code") or d.get("activation_code") or "")' 2>/dev/null
}

# provision_patient KEY PATIENT_ID USERNAME ACTIVATION_CODE — the patient
# redeems the activation code, choosing a username. Echoes the HTTP status.
provision_patient() {
  redeem_as "$1" "$2" "$4" "$3" "$3"
}

# remember_credentials KEY LOGIN_ID PASSWORD -- kept beside the token so a
# gated step can be confirmed as the person who signed in (ADR-0008 Class C).
remember_credentials() {
  printf '%s' "$2" > "$ACTOR_DIR/$1.login"
  printf '%s' "$3" > "$ACTOR_DIR/$1.password"
}

# confirm_transaction KEY BODY IDEMPOTENCY_KEY -- answer the 428 in /tmp/mc_body
# as the portals do through their dialog: a challenge bound to the SHA-256 of
# BODY's exact bytes and this key, verified with the actor's password proof.
# Echoes the authorization id, or nothing when the actor cannot confirm.
confirm_transaction() {
  local u="$1" b="$2" key="$3" digest request cid factor answer
  [ -f "$ACTOR_DIR/$u.login" ] || return 0
  digest=$(printf '%s' "$b" | sha256sum | cut -d' ' -f1)
  request=$(body | python -c '
import json, sys
details = (json.load(sys.stdin).get("error") or {}).get("details") or {}
print(json.dumps({k: details.get(k) for k in ("action", "method", "path", "resource_id", "expected_state")}
                 | {"body_digest": sys.argv[1], "idempotency_key": sys.argv[2]}))' "$digest" "$key")
  [ "$(code POST /api/auth/transaction/challenge "$request" "$u")" = "200" ] || return 0
  cid=$(jget challenge challenge_id); factor=$(jget challenge required_factor)
  [ "$factor" = "password" ] && [ -n "$cid" ] || return 0
  answer=$(python -c 'import json, sys; print(json.dumps({"challenge_id": sys.argv[1], "auth_proof": sys.argv[2]}))' \
    "$cid" "$(proof "$(cat "$ACTOR_DIR/$u.login")" "$(cat "$ACTOR_DIR/$u.password")")")
  [ "$(code POST /api/auth/transaction/verify "$answer" "$u")" = "200" ] && jget authorization_id
}

# code METHOD PATH [BODY] [ACTOR_KEY] [AUTHORIZATION]
code() {
  local m="$1" p="$2" b="${3:-}" u="${4:-}" authorization="${5:-}" key="" status
  local args=(-s -m 20 -o /tmp/mc_body -w '%{http_code}' -X "$m" "$BASE$p")
  # Only when there is a caller. The middleware refuses a *keyed* mutation
  # that carries no subject (409 IDEMPOTENCY_AUTH_REQUIRED) before
  # authorization runs, so sending a key on a deliberately anonymous request
  # replaces the 401 those assertions are about with a 409 from a different
  # layer. An anonymous caller has no operation to make idempotent.
  if [ -n "$u" ]; then
    case "$m" in
      POST|PUT|PATCH|DELETE)
        key="${MC_IDEMPOTENCY_KEY:-$(python -c 'import uuid;print(uuid.uuid4())')}"
        args+=(-H "Idempotency-Key: $key")
        ;;
    esac
    args+=(-H "Authorization: Bearer $(tok_of "$u")")
  fi
  [ -n "$authorization" ] && args+=(-H "X-Transaction-Authorization: $authorization")
  [ -n "$b" ] && args+=(-H 'Content-Type: application/json' -d "$b")
  status=$(curl "${args[@]}")
  # A Class C demand on a gated step made by the right person: confirm once as
  # that person and resend under the same key.
  if [ "$status" = "428" ] && [ -n "$u" ] && [ -z "$authorization" ] \
    && grep -q TRANSACTION_AUTHORIZATION_REQUIRED /tmp/mc_body 2>/dev/null; then
    authorization=$(confirm_transaction "$u" "$b" "$key")
    if [ -n "$authorization" ]; then
      MC_IDEMPOTENCY_KEY="$key" code "$m" "$p" "$b" "$u" "$authorization"
      return
    fi
  fi
  printf '%s' "$status"
}
body() { cat /tmp/mc_body 2>/dev/null; }


# jget KEY [KEY...] — walk nested JSON keys. Passed as argv, never interpolated
# into the Python source, so quoting cannot break it.
jget() { body | python -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for k in sys.argv[1:]:
    if isinstance(d, dict) and k in d:
        d = d[k]
    else:
        sys.exit(0)
print("" if d is None else d)
' "$@" 2>/dev/null; }

