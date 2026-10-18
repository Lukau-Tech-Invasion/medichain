# MediChain on AWS — runbook

One EC2 instance in **af-south-1 (Cape Town)** runs the Docker Compose stack
behind Caddy (Let's Encrypt TLS). Data stays in South Africa (POPIA).

| Piece | Where |
| --- | --- |
| Stack template | `infra/aws/medichain.yaml` (af-south-1) |
| Budget template | `infra/aws/budget.yaml` (us-east-1: AWS Budgets is not a CloudFormation type in af-south-1) |
| Deploy script | `infra/aws/deploy.sh` |
| Compose overlay | `docker-compose.aws.yml` + `Caddyfile.aws` |
| Audit checkpoints | S3 bucket with Object Lock (COMPLIANCE, 6 years by default); written once by `AUDIT_CHECKPOINT_SINK=s3` (`api/src/audit_s3_sink.rs`) |
| Backups | pgBackRest repo 1 on the instance's encrypted volume; repo 2 in the backup bucket, encrypted by pgBackRest before upload |
| Secrets | One Secrets Manager secret (JSON); `deploy.sh` adds missing keys once and never rotates one silently |
| Shell access | SSM Session Manager only; no SSH port, no key pair |

## Before the first deploy (owner decisions and permissions)

1. **Opt in to af-south-1.** Cape Town is an opt-in region: Account → AWS Regions → Enable.
2. **Who runs this.** The deploying identity needs CloudFormation, EC2, IAM
   (create roles/instance profiles: `CAPABILITY_IAM`), S3, ECR, Secrets
   Manager, CloudWatch Logs, SSM Run Command, and for the budget stack, Budgets
   in us-east-1. The local `Keorapetswe` IAM user cannot do this today; the
   owner grants permissions or runs the deploy.
3. **Domain.** A host name you control. After step 1 below, point its **A**
   record at the `ElasticIp` output; Caddy cannot get a certificate until it
   resolves.
4. **Retention.** `AuditRetentionDays` (default 2190 = 6 years) in COMPLIANCE
   mode cannot be shortened once a checkpoint exists. Confirm the period against
   the records policy before the first deploy; use `AuditRetentionMode=GOVERNANCE`
   for a rehearsal stack.
5. **Cost.** A t3.small, 40 GiB gp3, an Elastic IP and small S3/ECR/log usage:
   roughly USD 25–40 a month in af-south-1 at list price. Deploy `budget.yaml`
   for alerts.

## Deploy

```bash
DOMAIN=records.example.org ACME_EMAIL=ops@example.org infra/aws/deploy.sh
```

The script refuses a dirty working tree (images are tagged with the commit) and
any region other than af-south-1. It is safe to rerun: the stack updates in
place, existing secrets are kept, and existing image tags are skipped.

Budget alerts (once, in us-east-1):

```bash
aws cloudformation deploy --region us-east-1 --stack-name medichain-budget --template-file infra/aws/budget.yaml --parameter-overrides BudgetEmail=ops@example.org MonthlyBudgetUsd=60
```

## First administrator

The API creates the first administrator only through `POST /api/auth/bootstrap`
with `MEDICHAIN_BOOTSTRAP_KEY`, and refuses once one exists.

1. Add `MEDICHAIN_BOOTSTRAP_KEY` (at least 32 random characters) to the secret,
   rerun `deploy.sh`.
2. `POST https://$DOMAIN/api/auth/bootstrap` with `secret_key`, `login_id`, `name`;
   the response carries a one-time credential code.
3. Redeem it at `https://$DOMAIN/doctor/activate`, enrol two-factor.
4. **Remove** `MEDICHAIN_BOOTSTRAP_KEY` from the secret and rerun `deploy.sh`.

## Verify after every deploy

| Check | How |
| --- | --- |
| HTTPS and health | `curl -fsS https://$DOMAIN/api/health` |
| Production profile | `IS_DEMO=false`, demo sign-in absent on `/doctor/login`, `REQUIRE_SIGNATURES=true` (Session Manager: `docker compose ... exec api env`) |
| Audit seal | `GET /api/health` reports the seal as `ed25519` and the sink as `s3`; after a few minutes objects appear under `s3://<AuditBucketName>/checkpoints/`, and a second write to an existing key is refused by the bucket policy |
| Backups | `docker compose ... exec postgres pgbackrest --stanza=medichain check`, then a full backup to repo 2 |
| Restore rehearsal | Before admitting real data: restore repo 2 into a scratch container (`docker/postgres/restore-test-inner.sh`) and compare row counts |
| Logs | CloudWatch Logs group `/medichain/<stack>/containers` |

## Backups — the instance-role fallback

`PGBACKREST_REPO2_S3_KEY_TYPE=auto` asks pgBackRest for temporary credentials
from the instance role. pgBackRest's documentation does not say how it reaches
instance metadata; the launch template allows IMDSv2 from containers (hop limit
2). If `pgbackrest check` fails on repo 2 with a credentials error, create an
IAM user limited to the backup bucket's `medichain/` prefix, set
`PGBACKREST_REPO2_S3_KEY_TYPE=shared` with `PGBACKREST_REPO2_S3_KEY` and
`PGBACKREST_REPO2_S3_KEY_SECRET` in the secret, and redeploy. The first backup
and the restore rehearsal are the proof either way.

## Roll back

Rerun `deploy.sh` with `TAG=<previous commit>`; images are immutable in ECR.
Database migrations only move forward, so a rollback across a migration needs
a restore from backup.

## What this deployment does not provide yet

* **Real provider integrations** are off until configured: telehealth
  (`TELEHEALTH_ENABLED=false`), SMS, regulator e-mail (`SMTP_HOST`), translation.
* **Single instance**: a host failure triggers EC2 auto-recovery (CloudWatch
  alarm) but there is no second copy of the application. Backups in S3 are the
  recovery path for the data.
* **Offline medical ID** in the patient app is cleared on sign-out but is not
  encrypted at rest while signed in (`docs/TECHNICAL_DEBT_REGISTER.md`).
* **ADR-0008 Class C phase 2** (device-bound confirmation) is not implemented.
