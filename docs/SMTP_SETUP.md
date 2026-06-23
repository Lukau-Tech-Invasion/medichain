# MediChain SMTP Setup & Configuration

MediChain uses SMTP for automated notifications to regulators and data subjects during security breaches (HIPAA/POPIA compliance).

## Provider Options

We recommend using one of the following providers:
*   **AWS SES** (Scalable, low cost)
*   **SendGrid** (Easy integration)
*   **Mailgun** (Developer-friendly)
*   **Local SMTP Relay** (For on-premise deployments)

## Configuration (Environment Variables)

Enable SMTP by setting the following environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `SMTP_ENABLED` | Toggle SMTP dispatch | `true` |
| `SMTP_HOST` | SMTP server hostname | `email-smtp.us-east-1.amazonaws.com` |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USERNAME` | Authentication username | `AKIA...` |
| `SMTP_PASSWORD` | Authentication password | `...secret...` |
| `SMTP_FROM_EMAIL` | Sender email address | `notifications@medichain.org` |
| `REGULATOR_EMAIL` | National health regulator email | `breach-reports@moh.gov.za` |

## Breach Notification Workflow

When a breach is declared via `/api/admin/security/breach`:
1.  **Immediate:** SMS is sent to configured security officers.
2.  **Automated:** An email is dispatched to the `REGULATOR_EMAIL`.
3.  **Manual/Batch:** Affected data subjects are identified, and emails are queued for delivery (Phase 11.4 follow-up).

## Local Development / Testing

For local development, we recommend using [MailHog](https://github.com/mailhog/MailHog) or [Mailtrap](https://mailtrap.io/) to capture outgoing emails without sending them to real addresses.

```bash
# Example MailHog config
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_ENABLED=true
```
