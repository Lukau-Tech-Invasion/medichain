# MediChain: AWS hosting and FNB App of the Year research

Research date: 7 October 2026, South Africa. Research and deployment proposal only; no infrastructure provisioned, account created, database reset, or submission sent.

## Decision

Host the two existing React portals, Rust API, PostgreSQL and background jobs together on one AWS Linux server. Use S3 for separate-host backups and signed audit checkpoint copies. Serving the frontends from the existing Nginx container adds no separate hosting charge and preserves the current same-origin authentication and SSE design.

For the lowest predictable ongoing bill, investigate a **2 GB Lightsail Linux instance with public IPv4 at $12/month**, increasing to 4 GB at $24/month only if measurement requires it. Lightsail is listed in AWS's Free Tier services for its new sign-up experience, but its advertised 90-day trial requires the Paid Plan. Verify actual account access and promotional-credit applicability in the console before launching; do not assume the trial applies to a Free Plan account. [Lightsail prices](https://aws.amazon.com/lightsail/pricing/), [sign-up service availability](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html), [trial conditions](https://aws.amazon.com/free/compute/lightsail-vs-ec2/).

For South African hosting, use **EC2 in Cape Town (`af-south-1`)**, starting the capacity evaluation with `t3.small` (2 GB RAM). This is explicitly Free Plan eligible; T3 is available in Cape Town. **Lightsail has no Cape Town region.** A 2 GB machine is a candidate for the core awards workload, not a proven capacity result. [Free Plan EC2 types](https://aws.amazon.com/free/compute/lightsail-vs-ec2/), [EC2 region availability](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html), [Lightsail regions](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-regions-and-availability-zones-in-amazon-lightsail.html).

The user confirmed the AWS account has not yet been created and will be new. Eligibility still depends on AWS's new-customer rules. Choose the Free Plan deliberately; do not activate paid features inadvertently.

## 1. Free account boundaries

New eligible customers receive $100 initially and can earn up to another $100. The Free Plan ends after six months or when credits run out. AWS then closes access unless the account is upgraded; the documented data recovery window is 90 days. Credit expiry is separate: current FAQ states 12 months from account creation. Check the account's displayed dates. Existing/prior AWS customers are ineligible for this introductory plan. [AWS FAQ](https://aws.amazon.com/free/free-tier-faqs/).

**No durable promise of permanently free full MediChain hosting is supported by these terms.** Keep the hosted demo running throughout confirmed judging dates and maintain recoverable backups before account expiry.

AWS's staged new sign-up experience lists EC2, Lightsail, S3, SES and RDS under Free Tier access, but Translate, Transcribe and End User Messaging SMS under Paid Plan access. The document warns rollout is limited, so confirm which experience and restrictions apply to the actual account. Availability does not mean unlimited free usage. [Service access matrix](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html).

CloudFront's $0 flat-rate plan is a different product from the AWS Free account plan: AWS documents that Free Tier accounts cannot use CloudFront Flat-Rate Plans. Do not promise its bundled WAF, DNS or storage benefits for this account. [Account restriction](https://docs.aws.amazon.com/PricingPlanManager/latest/UserGuide/plans.html).

## 2. Application inventory retrieved from this checkout

| Component | Evidence | AWS destination / required work |
|---|---|---|
| Doctor portal | `client/doctor-portal`, `client/Dockerfile` | Nginx static files under `/doctor/` on the main server |
| Patient PWA | `client/patient-app`, `client/Dockerfile` | Nginx static files under `/patient/`; HTTPS and manifest/service-worker verification |
| Landing page | `client/landing.html` | Same Nginx server at `/` |
| API | `api/Dockerfile`, Rust workspace | Existing Actix binary/container; internal port 8080, no public direct API port |
| Database | `docker-compose.yml` | PostgreSQL 16 on durable encrypted server storage; internal network only |
| Medical documents | `api/src/ipfs.rs` | Current database-backed encrypted storage travels with PostgreSQL; direct S3 document storage would require code changes |
| Audit seals | `api/src/audit_batching.rs`, `api/src/audit_seal.rs` | API job plus persistent checkpoint volume; export copies to S3 using a new uploader or native sink |
| Sessions, consent, grants, clinical data | PostgreSQL repositories | Same database and backups; no mandatory new Cognito or DynamoDB service |
| SSE realtime | `api/src/websocket.rs`, `nginx/default.prod.conf` | Existing API and proxy; preserve unbuffered `/api/events` and long timeout |
| Backup/WAL archive | `docker-compose.backup.yml` | pgBackRest on server; replace Azure repository 2 with S3 configuration |
| Email | `api/src/notifications.rs` | SES SMTP is compatible with existing transport; verify actual sender and recipient delivery |
| Telehealth | `api/src/telehealth.rs`, `docker-compose.jitsi.yml` | Private Jitsi on AWS if enabled; separate capacity, DNS, UDP and NAT traversal work |
| Call recordings | Jibri profile, `scripts/jibri-finalize.sh` | AWS recorder host and ingest path; disk retention, authorization, storage and download validation |
| SMS and inbound preferences | `api/src/notifications.rs`, `api/src/handlers/sms_preferences.rs` | Current Africa's Talking integration needs an AWS SMS adapter and inbound webhook mapping |
| Push | `client/shared/src/push.ts`, `api/src/notifications.rs` | Current Firebase integration; AWS notification orchestration requires integration changes and still ultimately uses device/browser push networks |
| Machine translation | `api/src/services/translation.rs` | Current Google adapter only; Amazon Translate is a proposed replacement, not implemented |
| National ID verification | `api/src/national_id.rs`, `api/src/startup.rs` | Government services remain external authorities; validate actual contracts/endpoints, not just environment variables |
| Monitoring | production Compose monitoring profile | Small log/disk/health monitoring initially; Prometheus/Grafana optional on AWS if budget/capacity permits |
| Clinical policies/overlays | Compose policy mount, `.env.example` | Durable read-only files, versioned alongside deployment; mount optional licensed drug-data overlays explicitly |
| NFC/offline capabilities | frontend/device features | Hosting does not replace physical cards, device permissions, supported hardware, or offline validation |
| Admin tooling | pgAdmin profile | Disabled by default; operator-only access when needed |

No Redis, Kubernetes, GPU inference cluster or IPFS daemon is required by the active base Compose services inspected. The old `ipfs_data` volume is retained for recovery and is not mounted by a running service. Some comments still mention retired infrastructure; use the active services and code rather than those comments.

This inventory traces hosting dependencies, not every clinical endpoint or a fresh application acceptance run. Existing worktree changes were preserved. Local historical verification reports disagree with later fixes, so they are not used as current release certification.

## 3. Proposed AWS layout

```text
Judge / patient / clinician browser
                |
             HTTPS
                |
      AWS Linux server + Nginx
      /doctor/ /patient/ /api/
                |
        Rust API + audit jobs
                |
       PostgreSQL private network
                |
       durable encrypted disk

Scheduled encrypted DB backups ------------> private S3 backup bucket
Signed audit checkpoint copies -----------> separate S3 audit bucket
SMTP, when configured --------------------> Amazon SES
Video, when enabled ----------------------> private AWS Jitsi + TURN
```

One host is a deliberate awards-budget choice and a single point of failure. S3 backups improve recovery, not live availability. Real clinical deployment needs separate availability, privacy, governance and operational review.

### Account and network essentials

1. Root MFA, recovery details and a separate least-privilege operator identity; no root access keys.
2. One region selected before creating resources. For Cape Town, enable the opt-in region and confirm launch quota/type availability.
3. On EC2, one VPC/subnet and internet gateway; no NAT gateway needed for this public-server layout. Only Nginx has public application ports.
4. HTTPS 443 and HTTP 80 only for redirect/certificate issuance as needed; SSH restricted to operator IP or use Systems Manager where supported. PostgreSQL, pgAdmin, Grafana and the API container remain private.
5. Stable address and hostname; attach an Elastic IP on EC2 or a Lightsail static IP. Existing domain/registrar DNS can avoid an additional Route 53 zone.
6. Automated trusted TLS certificate renewal; the existing production Nginx configuration expects mounted certificates. Test redirects and renewals.
7. Encrypted EBS on EC2; persistent PostgreSQL, backup and checkpoint volumes; documented disk capacity and retention.
8. Least-privilege EC2 instance role for S3 upload/backup, with IMDSv2 and verified container credential access. On Lightsail, determine a supported scoped credential approach rather than assuming EC2 instance profiles exist.
9. Separate backup and audit credentials/permissions; secure offline recovery of encryption and signing keys. Losing keys can make retained data unusable.
10. Cost/credit alerts, resource tags, bounded log rotation and retention; budget notifications do not act as a hard spending cap on a Paid Plan.

### Build and deployment essentials

- Build Rust/API and frontend images before copying them to a small host. The API builder needs Rust 1.88+, OpenSSL tooling and protobuf compiler; its runtime image is much smaller. Avoid making judges wait for builds or exhausting a tiny server during compilation.
- Match architecture: x86 images for T3/Lightsail; ARM64 rebuild and dependency verification before selecting cheaper Graviton T4g.
- Use an immutable release identifier/digest and an approved source snapshot. The current checkout has substantial uncommitted changes; deploying remote `main` alone could omit them.
- Keep runtime secrets outside source and images. No backend secret in `VITE_*` variables, which are public browser build output.
- Existing CI can build releases; if private ECR is used, verify Free Plan availability and storage charges. Direct image transfer avoids a mandatory registry service. Never publish private images/source to ECR Public for convenience.
- Pin image versions, configure restart policies and health/readiness probes, and cap memory/connections based on measurement.
- Apply migrations through the existing API startup process with a backup first. For existing DB imports, validate SQLx migration history before startup; old migrations have local changes and blindly rerunning them is unsafe.
- Supply real secrets and production environment settings from the production Compose override. Review `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEYS`, `PATIENT_SEARCH_INDEX_KEY`, `NATIONAL_ID_HASH_KEY`, `AUDIT_SEAL_SIGNING_KEY`, `METRICS_TOKEN`, `SMS_INBOUND_WEBHOOK_SECRET`, database credentials and backup passphrases.
- Set allowed HTTPS origins, `MEDICHAIN_APP_URL` where join links use it and `CLINIC_TIMEZONE=Africa/Johannesburg`. Preserve credential refresh, session revocation, signature/step-up and role enforcement.
- Explicitly turn off dev/bootstrap credential conveniences on public hosting. A synthetic awards profile may be appropriate, but its demo flags do not constitute clinical production configuration.
- The current awards override binds Nginx to loopback. It cannot be copied unchanged and expected to accept internet requests. The production override publishes 443 but does not publish 80: certificate issuance and redirects need a deliberate port decision.
- Optional monitoring still requires `GRAFANA_ADMIN_PASSWORD` during production Compose interpolation. Do not discover this missing value during deployment.

### Backups and audit storage

The existing off-site override points to **Azure Blob**, so using it unchanged violates the AWS backend requirement. pgBackRest supports S3 repository buckets, regional endpoints and automatic temporary credentials; implement a new AWS override and test it with the packaged pgBackRest version. [pgBackRest S3 configuration](https://pgbackrest.org/configuration.html#section-repository/option-repo-s3-bucket).

For an initial disposable synthetic demo, encrypted scheduled `pg_dump` backups uploaded to S3 can be a simpler temporary recovery mechanism. State its backup interval and loss window; it does not provide continuous point-in-time recovery. Existing pgBackRest/WAL integration is the fuller option.

The application currently supports checkpoint sink `none` or `filesystem`; **S3 is not an existing native sink**. Add a verified uploader that tracks successful copies, retries failures and alerts on lag, or implement an S3 sink after approval. Local `exported` status does not prove remote durable upload. Keep private S3 buckets with TLS-only access, encryption, bounded retention and least privilege.

Use a separate versioned S3 audit bucket if write-once proof is required. Object Lock protects object versions; governance mode allows privileged bypass, while compliance retention cannot be shortened. Prototype retention safely before choosing irreversible compliance periods. Object Lock does not protect encryption keys. [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html), [operational considerations](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html).

Restore the database on a different AWS host and verify accounts, clinical data, documents and audit chain. A snapshot or successful upload alone is insufficient.

## 4. Every integration on AWS: what changes

**All application-owned server components can live on AWS. That does not make government identity systems, mobile carriers or browser push services AWS-owned.** Two scopes must be distinguished:

- AWS infrastructure scope: all our servers, DBs, documents, jobs and backups on AWS, with legitimate external provider calls.
- AWS provider replacement scope: migrate replaceable integrations to AWS as well; requires additional code and some Paid Plan capabilities. External delivery/identity networks still exist.

| Capability | Minimum AWS route | Budget / acceptance boundary |
|---|---|---|
| Email | Configure existing SMTP transport against SES, verified sender/domain and TLS | Pay-as-you-go baseline $0.10/1,000 outbound messages plus applicable data charges; sandbox restricts recipients and rate. Judge email addresses may need verification or production access |
| SMS | Add AWS End User Messaging SMS adapter; provision supported origination number and inbound routing | Paid Plan in staged signup; country/number/message-segment charges. South Africa lists long/short codes and two-way SMS, not Sender IDs; current STOP webhook needs compatible integration |
| Push | Retain in-app notifications on AWS; redesign external push orchestration if required | Firebase code is not replaced by a new environment variable. Device/browser push ultimately depends on platform services; prove delivery on actual devices |
| Translation | Add Amazon Translate provider and clinical warning handling | $15/million standard-text characters at list price; verify language coverage and account/region access. Static UI translations need no translation API |
| Dictation | Inspect actual page/device implementation; Amazon Transcribe only if needed | Paid Plan in staged signup; browsers may use external speech services. Do not assume browser dictation is local or migrate it without evidence |
| Video | Self-host current JWT-authenticated Jitsi stack, with TURN on AWS | Jitsi suggests 8 GB, allows 4 GB small meetings and 2 GB very small/test setups. Sharing the 2 GB core host with Jitsi is not an approved capacity assumption |
| Recording | AWS Jibri host, storage and authenticated ingestion | Separate resource allowance, secure deletion/retention, record-and-playback proof; not included in the $12 core-host estimate |
| Identity | Run MediChain verifier on AWS, retain authorized government API access or manual review | Current URLs are implementation defaults, not evidence of authority access. Production requires live mode, but missing country keys leave explicit manual-review cases |

Sources: [SES charges](https://aws.amazon.com/ses/pricing/), [SES sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), [SMS South Africa capabilities](https://docs.aws.amazon.com/end-user-messaging/latest/userguide/nx-supported-countries-africa.html#nx-supported-countries-africa-south-africa), [Translate charges](https://aws.amazon.com/translate/pricing/), [Jitsi requirements](https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-requirements/), [AWS plan availability](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html).

Do not build a new integration around Amazon Pinpoint engagement features: support ends **30 October 2026**. Its messaging APIs continue under AWS End User Messaging. [AWS notice](https://docs.aws.amazon.com/pinpoint/latest/userguide/migrate.html).

If all these live capabilities are required, the low-cost core demo is not the entire budget or implementation. Disabled integrations must be visibly unavailable; never present logging or captured MailHog messages as actual delivery.

## 5. Cost model

USD, before taxes, exchange-rate effects, optional integrations and usage overages. Use 730 hours/month. Costs below are resource consumption before promotional credits; zero cash paid while eligible credits cover usage is not zero consumption.

| Option | Published compute price | Other costs | Decision |
|---|---:|---|---|
| Lightsail Linux, 2 GB, IPv4 | $12/month, including 60 GB SSD and 3 TB transfer allowance | S3 backups/checkpoints, retained snapshots and optional services | Cheapest published predictable candidate; confirm Free Plan/credit access |
| Lightsail Linux, 4 GB, IPv4 | $24/month, including 80 GB SSD | Same extras | Capacity fallback; no published promise that it runs every integration |
| EC2 `t3.small`, US East reference | $0.0208/hour = $15.18/month | IPv4 $3.65/month; 30 GB gp3 at illustrative $0.08/GB-month = $2.40; subtotal $21.23 before S3/snapshots | Auditable reference arithmetic, **not a Cape Town quotation** |
| EC2 Cape Town | Regional compute and disk quote still needed | IPv4, disks, backups, logs and optional services | South African hosting route; do not use US price as regional price |
| Separate Jitsi/recording host | Not quoted | CPU/RAM, disks, IP, transfer, TURN/recording traffic | Benchmark and quote separately if required |

[Lightsail bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html), [AWS published T3 reference pricing](https://docs.aws.amazon.com/prescriptive-guidance/latest/optimize-costs-microsoft-workloads/right-size-selection.html), [IPv4 price](https://aws.amazon.com/vpc/pricing/), [gp3 pricing example](https://aws.amazon.com/ebs/pricing/), [S3 pricing](https://aws.amazon.com/s3/pricing/).

Planning allowances, **not vendor quotes**: set aside $1–3/month for small synthetic S3 backups/checkpoints and $1–5 for bounded snapshots/logging, then replace these with a calculator estimate using actual stored GB, retained versions, WAL volume, request counts and snapshot changes. Database-internal document storage and recordings can increase this substantially.

At an illustrative total consumption of $25/month, $100 covers about four months and $200 eight months of consumption, but the **Free Plan still ends at six months**. If all $200 are earned, staying within six months implies about $33.33/month average; with only $100, about $16.67. Account expiry, individual service eligibility and credit dates still control.

Savings choices:

- Serve both portals on the existing Nginx host: $0 incremental hosting service.
- Avoid EKS, an ALB, NAT Gateway, managed Redis, Aurora, separate paid frontend hosting and multi-region services at this stage. They are not requirements of the inspected application.
- Do not buy Windows hosting; current containers are Linux.
- Avoid Spot for the judging server; interruption risk undermines access.
- Build before deployment; keep log retention short and rate-limits/uploads bounded.
- No dedicated SES IP or email-marketing service required.
- Keep only required volumes/images/snapshots, after recovery review. Stopping EC2 leaves disk/IP costs; stopping Lightsail does not remove its bundle charges. Decommission unused resources deliberately after backups.
- Do not promise a hard spending ceiling using a budget email. Track credit balance and expiry directly.

## 6. Frontend alternatives

| Choice | Fit and tradeoff |
|---|---|
| Existing Nginx on AWS | Recommended for submission: no extra bill, same-origin cookies/API, existing `/doctor/` and `/patient/` layout |
| Cloudflare Pages Free | Legitimate $0 static frontend alternative; 500 builds/month, 20,000 files and 25 MiB/file limit. AWS backend remains required. Separate origins require API URL build configuration, CORS, credential-refresh and SSE testing |
| Private S3 + conventional CloudFront | AWS-native static hosting option; compare pay-as-you-go account allowances, storage/requests, routing and certificates. Two SPA fallbacks must be designed without swallowing API errors |
| Amplify Hosting | Convenient AWS frontend CI/hosting; metered build/delivery/storage, plan-specific allowances. Not automatically cheaper than serving existing static files on the API server |

[Cloudflare limits](https://developers.cloudflare.com/pages/platform/limits/), [Amplify pricing](https://aws.amazon.com/amplify/pricing/), [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/).

Cloudflare Pages is not a cheaper server substitute: the AWS API/database host is still necessary. Cross-origin authentication adds work because the shared client uses HttpOnly refresh cookies. Current Docker frontend build does not expose every possible Vite API setting as a build argument; external hosting requires an explicit build change or direct workspace build configuration.

## 7. FNB App of the Year: verified facts and conflicts

**Update from public organiser LinkedIn research on 7 October: awards entries close Friday 23 October 2026; the virtual hackathon runs 23-25 October 2026.** The exact closing time/timezone and awards judging schedule remain unverified. The organiser company listing was retrieved through public web search; a direct fetch returned a rate-limit response. Do not use the hackathon end date as the entry deadline. [Organiser LinkedIn](https://za.linkedin.com/company/app-of-the-year). Retrieved search text still contains 2025 closure copy, but the live browser form **FNB App of the year 2026** successfully loaded on follow-up inspection. Current displayed content takes precedence over stale indexed closure text. The form was inspected without entering personal data or submitting. [Entry page](https://appoftheyear.co.za/enter-now/), [linked form](https://www.cognitoforms.com/f/GiAnl_2m80ysXyBsOhwnMg/121).

The public FAQs also include older Academy copy. Treat awards guidance below as published guidance; ask the organiser to confirm the current 2026 specifics.

Verified published requirements:

- Usable complete solution for judges; App Store publication is not mandatory.
- Remote access and login details required for an unpublished app.
- Screenshots/images can be uploaded through the submission page.
- Two judging phases followed by an awards event; shortlisted entrants contacted by phone/email.
- Criteria cover product, creativity, usability, sustainability, impact, presentation and intelligence. Product assessment includes traction.

[Awards FAQs](https://appoftheyear.co.za/faqs/).

The 2026 terms specify one free category, **R250 excluding VAT per additional category**, timely entry, accurate/current information and the stated sponsor/promoter eligibility exclusions. International travel documentation is a conditional prize requirement, not a verified universal entry upload. [2026 terms](https://appoftheyear.co.za/terms-conditions/).

**Recommended category: Best Health Solution**, whose description explicitly includes emergency information and access to healthcare. Other possibilities: Best Enterprise Solution or Most Innovative Solution; budget extra-category fees only if worthwhile. Best Hackathon Solution is described as resulting from the FNB Hackathon; a Rust Africa win alone does not prove eligibility for it. [Current category list](https://appoftheyear.co.za/app-categories/).

PWA-only submission acceptance is not explicitly stated. The FAQ allows unpublished remotely accessible applications, but that is not definitive confirmation of browser-only PWA eligibility.

## 8. Supporting documents and submission pack

### Verified published needs

1. An application judges can actually use remotely.
2. All required login details/access instructions for an unpublished app.
3. Accurate entry details and category choice; submission before the confirmed closing date.
4. Screenshots/images: published upload support, but mandatory count/format is unverified.

**Follow-up: the actual form has now been inspected.** Required markers appear on contact/company information, category, app name, publication location, development country, invoice details/address/email and terms/privacy acceptance. Other visible fields cover description, icon, APK/app links, price, supporting files and demo login instructions. Marketing consent is separate. [Live entry form](https://www.cognitoforms.com/f/GiAnl_2m80ysXyBsOhwnMg/121).

The **Supporting Documents** field has no required marker or explanatory checklist. Its file input permits multiple files, exposes no `accept` filter and is not HTML-required; these observations do not establish server-side limits. No displayed size/count limits or mandatory document types were found. Do not invent requirements for a deck, company registration, ID copy, tax certificate, business plan, clinical licence or video. The publication field offers an Other input, but formal PWA eligibility still needs confirmation.

A previous entrant publicly lists a developer-profile PDF and an app README among its supporting materials. This is an example of entrant practice, not organiser instruction or proof of what the organiser accepted as sufficient. [ZuluTech entrant materials](https://leonardphokane.github.io/zulutech-send-money/).

For MediChain, prepare a concise supporting PDF that covers product purpose, the patient/clinician journey, screenshots, verified evidence, impact, sustainability and developer background. Keep judge access instructions readily available and supply dedicated synthetic demo credentials through the form's separate login fields. Include a video link as a useful fallback rather than claiming a mandatory video duration.

### Recommended preparation, not claimed mandatory

| Material | What to prepare for MediChain |
|---|---|
| Entry copy | App name, owner/developer/company contact, product description, launch/version status, intended users and South African problem addressed |
| One-page product brief | Problem, practical solution, differentiator, verified capabilities, target users, impact and commercial route |
| Screenshots | Representative patient and clinician journeys, consent, emergency information, access history and a clear mobile view; synthetic data only |
| Demo video | Suggested 2–3 minutes; actual limit to be confirmed. Show a real connected journey, with captions and a backup copy |
| Short pitch deck | Suggested 6–8 slides: problem, solution, live journey, differentiation, evidence, sustainability, team and next steps |
| Judge access guide | Stable HTTPS URL; `/doctor/` and `/patient/`; private role credentials, device requirements, reset/recovery instructions and support contact |
| Demo scenario sheet | Patient controls access; clinician reads authorized record; relevant result appears to the patient; patient inspects access history; optional emergency scenario |
| Evidence sheet | Date/version, actual test scope, measured latency conditions, durable read-back and restart proof; distinguish synthetic demo from real adoption |
| Sustainability note | Who pays, plausible clinic pricing/revenue path, hosting consumption, recovery plan and post-credit operating cost |
| Privacy/security summary | Synthetic data declaration, authentication/roles, encryption, consent, audit seals and operational limits; no blanket compliance claims |
| Ownership/permissions folder | IP ownership and third-party asset/licence permissions; company/identity records ready if explicitly requested through a trusted submission channel |
| Mobile install instructions | PWA installation and browser compatibility; NFC/camera prerequisites. APK/TestFlight/store links only if applicable and required |
| Submission receipt | Save receipt/entry ID, submitted version/materials, chosen category, payment receipt if applicable and organiser communications |

Do not share super-admin credentials or `.browser-test/fixtures.json` publicly. Use dedicated synthetic judge accounts, least necessary roles and a recovery process. An email allowlist or device permission flow must not unexpectedly block judges.

### Questions that only the organiser can currently resolve

- Is the 2026 awards portal accepting entries? What is the exact closing date, time and timezone?
- Are browser-only PWAs eligible for Best Health Solution?
- Exact mandatory fields/documents and screenshots/video/deck limits?
- Minimum launch/traction/availability requirements; individual versus company eligibility?
- Judging dates, required uptime, judge email addresses and supported device/browser expectations?
- Presentation format and whether finalists have additional requested materials?
- Confirmation of category fees and how payment is handled?

Verified organiser contact: **admin@creativespacemedia.co.za**, **+27 11 467 3341**. Research did not send any message. [Contact page](https://appoftheyear.co.za/contact-us/).

Suggested enquiry to copy/send:

> Please confirm the 2026 FNB App of the Year entry deadline and judging dates. We intend to enter MediChain, a South African healthcare application with patient and clinician PWAs, for Best Health Solution. Is a browser-accessible PWA eligible? Please provide the complete mandatory submission checklist, upload formats/limits, any video or pitch requirements, eligibility documents, category fees and judge access requirements. The entry page still contains 2025 closure text while linking a form titled 2026, so please confirm the correct current portal.

## 9. Acceptance checklist before sending judges the URL

- [ ] Account plan, credits, expiry and service access checked; region-specific calculator estimate saved.
- [ ] Core server capacity measured under concurrent judge-like load; no OOM, connection exhaustion or disk pressure.
- [ ] HTTPS, certificate renewal, landing page and both portal deep links work externally.
- [ ] Synthetic judge login, refresh/reload, logout/revocation and role restrictions tested on a separate device.
- [ ] One complete clinician-to-patient workflow writes data and reads it back from the other role.
- [ ] Data/documents survive API and server restart; restored backup reproduces the workflow.
- [ ] SSE delivers authorized realtime updates through the actual hosted path.
- [ ] Audit signing/chain validation succeeds; S3 checkpoint upload is read back independently.
- [ ] Database/admin/debug/metrics exposure reviewed; dev credential endpoint unavailable.
- [ ] Enabled email/SMS/push delivers for real; unavailable integrations visibly labelled.
- [ ] If promised: two-device authenticated video, restrictive-network/TURN test, recording upload/playback and retention verified.
- [ ] Consent/access denial and emergency access audit checked using synthetic fixtures.
- [ ] PWA mobile install/offline and actual NFC/device behavior tested for every claim made in the entry.
- [ ] Deadline/PWA eligibility/form checklist confirmed and submission receipt retained.

## 10. Evidence method and remaining work

Repository reads: `CLAUDE.md`, base/production/awards/services/backup/Jitsi Compose files, API and client Dockerfiles, Nginx TLS config, shared client config/auth/push code, startup configuration, national ID/telehealth/notification/document/audit source and Jitsi deployment documentation. No secrets from the existing `.env` were read or printed.

The local library routing guide and coding checklist were consulted. Its Twelve-Factor source describes configuration and backing-service separation; retrieved source: `C:\Users\Admin\Downloads\Books-master\Books-master\free-library\12-open-book-repos\twelve-factor-app\content\en\config.md` (section III) and `backing-services.md` (section IV), Markdown without page numbers. That describes a design target; this application's provider-specific adapters still require code changes. The library does not supply current AWS prices, Free Plan entitlements or awards rules; official sources above supply those facts.

Outstanding before implementation: actual AWS account entitlements, regional cost quotation, measured RAM/disk/traffic, selection of live integrations, S3 backup/checkpoint implementation, organiser confirmation of upload limits/PWA eligibility and current-source deployment acceptance. The form-field retrieval limitation was resolved during follow-up browser inspection; document specifications remain unpublished in the inspected field. No application code or existing guidance was changed by this research.
