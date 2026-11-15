#!/bin/sh
# Fill the telehealth origin into the Content-Security-Policy at container start.
#
# The video visit loads Jitsi's external_api.js from, frames, and opens a
# websocket to https://$JITSI_DOMAIN. That domain is deployment configuration,
# so client/scripts/csp-header.mjs leaves placeholders and this fills them.
# Unset (the AWS default, telehealth off): the policy names no outside origin.
set -eu
conf=/etc/nginx/snippets/csp.conf
domain="${JITSI_DOMAIN:-}"
case "$domain" in
  *[!A-Za-z0-9.:-]*) echo "40-csp-telehealth: ignoring invalid JITSI_DOMAIN" >&2; domain="" ;;
esac
if [ -n "$domain" ]; then
  https="https://$domain"
  wss="wss://$domain"
else
  https=""
  wss=""
fi
sed -i -e "s#__TELEHEALTH_HTTPS__#$https#g" -e "s#__TELEHEALTH_WSS__#$wss#g" "$conf"
