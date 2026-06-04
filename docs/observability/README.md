# Observability (Phase 8.2)

The API exposes Prometheus metrics at **`GET /api/metrics`** (no auth — firewall
it to your scraper in production):

- `http_requests_total{method,path,status}` — request counter.
- `http_request_duration_seconds{method,path}` — latency histogram (drives the
  p95 budgets in `../PERFORMANCE_BUDGETS.md`).

Structured JSON logs are emitted when `LOG_FORMAT=json` (otherwise human-readable
`env_logger`). Both honor `RUST_LOG`.

## Prometheus

```yaml
# prometheus.yml
scrape_configs:
  - job_name: medichain-api
    metrics_path: /api/metrics
    static_configs:
      - targets: ["api:8080"]
rule_files:
  - prometheus-alerts.yml   # ships in this folder
```

`prometheus-alerts.yml` defines: instance down, >5% 5xx error rate, emergency-access
p95 over its 0.4s budget, overall p95 > 1s, and a 401-spike (credential-stuffing)
signal that pairs with `GET /api/admin/security/alerts`.

## Grafana

Import `grafana-dashboard.json` and pick your Prometheus datasource. Panels:
request rate by status, 5xx error ratio, p95 latency by route, and the
emergency-access p95 against its budget.

## Still open

- A single health dashboard aggregating DB / IPFS / blockchain probes (the raw
  probes exist at `/api/health` and `/health/ready`).
- Alertmanager routing (PagerDuty/Slack/email).
