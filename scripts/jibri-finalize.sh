#!/bin/sh
# Jibri finalize hook (WP7.6): upload a finished consultation recording to the
# MediChain API, then delete the local copy.
#
# Jibri runs this after each recording with the recording's directory as $1
# (Jibri's `finalize_script` setting). Files are named
# `<room>_<timestamp>.mp4`, where the room is `<JITSI_ROOM_PREFIX>-<session id>`
# (session ids are `TH-<uuid>`).
#
# The API refuses the upload (409) unless the clinician and the patient both
# consented in the app before recording started and neither withdrew; a
# refused recording is deleted here, not kept.
#
# Environment:
#   MEDICHAIN_API_URL                 e.g. https://api.example.org (HTTPS)
#   MEDICHAIN_RECORDING_INGEST_TOKEN  the same secret the API is given
#   JITSI_ROOM_PREFIX                 default MediChain
#
# Not yet wired into any container: adding the Jibri service is pending
# approval (see docker-compose.jitsi.yml).
set -eu

dir="${1:?usage: jibri-finalize.sh <recording directory>}"
api="${MEDICHAIN_API_URL:?set MEDICHAIN_API_URL}"
token="${MEDICHAIN_RECORDING_INGEST_TOKEN:?set MEDICHAIN_RECORDING_INGEST_TOKEN}"
# Jitsi lowercases room names, so the prefix is compared in lower case and the
# session id's "TH-" is restored (the rest of the id is a lowercase UUID).
prefix="$(printf '%s-' "${JITSI_ROOM_PREFIX:-MediChain}" | tr '[:upper:]' '[:lower:]')"

for file in "$dir"/*.mp4; do
  [ -f "$file" ] || continue
  room="$(basename "$file" .mp4 | tr '[:upper:]' '[:lower:]')"
  room="${room%_*}"
  rest="${room#"$prefix"}"
  session="TH-${rest#th-}"
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --request POST \
    --header "X-Recording-Ingest-Token: $token" \
    --header 'Content-Type: video/mp4' \
    --data-binary "@$file" \
    "$api/api/telehealth/sessions/$session/recordings")"
  case "$status" in
    201) echo "stored recording for $session" ;;
    409) echo "not kept: $session lacks both consents" ;;
    *) echo "upload failed for $session with HTTP $status; keeping the file for a retry" >&2
       continue ;;
  esac
  rm -f "$file"
done
