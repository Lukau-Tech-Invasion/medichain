#!/usr/bin/env bash
# Deploy MediChain to AWS (af-south-1). Run from the repository root by someone
# whose AWS credentials may create the stack (see infra/aws/RUNBOOK.md, "Who
# runs this"). Nothing here prints a secret.
#
#   DOMAIN=records.example.org ACME_EMAIL=ops@example.org infra/aws/deploy.sh
#
# Steps, each safe to repeat:
#   1. create or update the CloudFormation stack
#   2. add any missing application secret to Secrets Manager (never rotate one)
#   3. build the three images and push them to ECR, tagged with the commit
#   4. upload the compose bundle to the artifact bucket
#   5. on the instance, through SSM Run Command: fetch the bundle, write .env
#      from the secret and the stack outputs, pull and start the stack
set -euo pipefail

STACK="${STACK:-medichain}"
REGION="${AWS_REGION:-af-south-1}"
DOMAIN="${DOMAIN:?set DOMAIN to the public host name}"
ACME_EMAIL="${ACME_EMAIL:?set ACME_EMAIL for Lets Encrypt notices}"
TAG="${TAG:-$(git rev-parse --short=12 HEAD)}"

if [ "$REGION" != "af-south-1" ]; then
  echo "MediChain holds health records and deploys to af-south-1 only." >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Commit or stash local changes first: images are tagged with the commit ($TAG)." >&2
  exit 1
fi
for tool in aws docker git openssl python; do
  command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }
done

aws_() { aws --region "$REGION" "$@"; }
output() {
  aws_ cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo "1/5 stack $STACK in $REGION"
aws_ cloudformation deploy \
  --template-file infra/aws/medichain.yaml \
  --stack-name "$STACK" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "DomainName=$DOMAIN" "AcmeEmail=$ACME_EMAIL"

SECRET_ARN="$(output AppSecretArn)"
INSTANCE_ID="$(output InstanceId)"
ARTIFACTS="$(output ArtifactBucketName)"
API_REPO="$(output ApiRepositoryUri)"
WEB_REPO="$(output WebRepositoryUri)"
PG_REPO="$(output PostgresRepositoryUri)"
EIP="$(output ElasticIp)"

echo "2/5 application secrets"
CURRENT="$(aws_ secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query SecretString --output text)"
UPDATED="$(CURRENT="$CURRENT" python - <<'PY'
import base64, json, os, secrets
current = json.loads(os.environ["CURRENT"] or "{}")
generators = {
    "JWT_SECRET": lambda: secrets.token_hex(48),
    "SESSION_SECRET": lambda: secrets.token_hex(48),
    # "1:<base64 32 bytes>" -- the keyring format in api/src/encryption_keyring.rs.
    "ENCRYPTION_KEYS": lambda: "1:" + base64.b64encode(secrets.token_bytes(32)).decode(),
    "PATIENT_SEARCH_INDEX_KEY": lambda: secrets.token_hex(32),
    "NATIONAL_ID_HASH_KEY": lambda: secrets.token_hex(32),
    "METRICS_TOKEN": lambda: secrets.token_hex(32),
    "SMS_INBOUND_WEBHOOK_SECRET": lambda: secrets.token_hex(32),
    # An Ed25519 seed: 64 hex characters (api/src/audit_seal.rs).
    "AUDIT_SEAL_SIGNING_KEY": lambda: secrets.token_hex(32),
    "PGBACKREST_REPO1_CIPHER_PASS": lambda: base64.b64encode(secrets.token_bytes(48)).decode(),
    "PGBACKREST_REPO2_CIPHER_PASS": lambda: base64.b64encode(secrets.token_bytes(48)).decode(),
    "GRAFANA_ADMIN_PASSWORD": lambda: secrets.token_urlsafe(32),
}
added = [name for name in generators if not current.get(name)]
for name in added:
    current[name] = generators[name]()
print(json.dumps({"added": added, "secret": current}))
PY
)"
ADDED="$(UPDATED="$UPDATED" python -c 'import json,os; print(",".join(json.loads(os.environ["UPDATED"])["added"]))')"
if [ -n "$ADDED" ]; then
  UPDATED="$UPDATED" python -c 'import json,os; print(json.dumps(json.loads(os.environ["UPDATED"])["secret"]))' \
    > "${TMPDIR:-/tmp}/medichain-secret.json"
  aws_ secretsmanager put-secret-value --secret-id "$SECRET_ARN" \
    --secret-string "file://${TMPDIR:-/tmp}/medichain-secret.json" >/dev/null
  rm -f "${TMPDIR:-/tmp}/medichain-secret.json"
  echo "   added: $ADDED"
else
  echo "   all present"
fi

echo "3/5 images tagged $TAG"
REGISTRY="${API_REPO%%/*}"
aws_ ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
docker build -f api/Dockerfile -t "$API_REPO:$TAG" .
docker build -f client/Dockerfile -t "$WEB_REPO:$TAG" .
docker build -t "$PG_REPO:$TAG" docker/postgres
for image in "$API_REPO:$TAG" "$WEB_REPO:$TAG" "$PG_REPO:$TAG"; do
  # Tags are immutable: an existing tag is this commit already, skip it.
  docker push "$image" || echo "   $image already in ECR"
done

echo "4/5 bundle"
BUNDLE="${TMPDIR:-/tmp}/medichain-$TAG.tgz"
tar -czf "$BUNDLE" docker-compose.yml docker-compose.backup.yml docker-compose.prod.yml \
  docker-compose.aws.yml Caddyfile.aws nginx api/migrations/init docs/observability
aws_ s3 cp "$BUNDLE" "s3://$ARTIFACTS/bundles/$TAG.tgz" --only-show-errors
rm -f "$BUNDLE"

echo "5/5 start on $INSTANCE_ID"
REMOTE=$(cat <<EOF
set -euo pipefail
cd /opt/medichain
aws s3 cp s3://$ARTIFACTS/bundles/$TAG.tgz bundle.tgz --region $REGION --only-show-errors
tar -xzf bundle.tgz && rm bundle.tgz
umask 077
aws secretsmanager get-secret-value --secret-id $SECRET_ARN --region $REGION --query SecretString --output text \
  | python3 -c 'import json,sys; [print(f"{k}={v}") for k,v in json.load(sys.stdin).items()]' > .env
cat >> .env <<ENV
AWS_REGION=$REGION
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
ALLOWED_ORIGINS=https://$DOMAIN
AUDIT_CHECKPOINT_S3_BUCKET=$(output AuditBucketName)
PGBACKREST_REPO2_S3_BUCKET=$(output BackupBucketName)
MEDICHAIN_API_IMAGE=$API_REPO:$TAG
MEDICHAIN_WEB_IMAGE=$WEB_REPO:$TAG
MEDICHAIN_POSTGRES_IMAGE=$PG_REPO:$TAG
ENV
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REGISTRY
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.backup.yml -f docker-compose.prod.yml -f docker-compose.aws.yml"
\$COMPOSE pull
\$COMPOSE up -d --no-build --remove-orphans
\$COMPOSE ps
EOF
)
COMMAND_ID="$(aws_ ssm send-command --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "medichain deploy $TAG" \
  --parameters "commands=[$(python -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$REMOTE")]" \
  --query Command.CommandId --output text)"
aws_ ssm wait command-executed --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" || true
aws_ ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query '{status:Status,stdout:StandardOutputContent,stderr:StandardErrorContent}' --output yaml

cat <<EOF

Deployed $TAG.
  DNS:     $DOMAIN  A  $EIP   (Caddy obtains the certificate once this resolves)
  Health:  curl -fsS https://$DOMAIN/api/health
  Next:    infra/aws/RUNBOOK.md -- first admin account, backup + restore rehearsal,
           and the production-profile checks.
EOF
