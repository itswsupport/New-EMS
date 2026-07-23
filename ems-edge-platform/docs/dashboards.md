# Dashboards & Alerts

Grafana reads the EMS Postgres **read-only** and is fully provisioned — dashboards and alert
rules live in `grafana/` and deploy with `git pull` (dashboards auto-reload in ~30 s) plus a
`docker compose restart grafana` (to load alert rules). Open at `http://<host>:3300`.

## Dashboards (folder "EMS")

| Dashboard | uid | Purpose |
|-----------|-----|---------|
| **EMS Overview** | `ems-overview` | power, PF, voltage, THD, per-phase (the original) |
| **EMS Cost & Demand** | `ems-cost-demand` | Max Demand vs contract, energy cost, PF penalty, kVArh |
| **EMS Power Quality** | `ems-power-quality` | V/I THD, voltage & current imbalance, per-phase |
| **EMS Plant Rollup** | `ems-plant-rollup` | plant totals, meters-online, per-meter contribution |

### Cost & Demand variables
Two editable variables at the top of the dashboard (no redeploy to change):
- **`contract_kva`** — your contracted/sanctioned demand (default 300). The gauge shows
  demand as **% of this** (green < 85%, amber 85–100%, red > 100% = penalty zone).
- **`tariff`** — energy price per kWh (default 8). Drives the "Estimated cost" stats.

Set them from the dashboard's variable bar; they persist per-browser.

## Alerts (folder "EMS Alerts")

Visual-only — state shows in **Alerting → Alert rules** (Normal / Pending / Firing) and on
dashboards; nothing is emailed or pushed (see `grafana/provisioning/alerting/contactpoints.yaml`).

| Rule | Fires when | Severity |
|------|-----------|----------|
| **Meter offline** | a meter hasn't reported for > 60 s | critical |
| **Max Demand near contract** | max demand > 270 kVA* | warning |
| **Low Power Factor** | PF < 0.9 for 2 min | warning |
| **Voltage out of range** | avg V outside 210–245 V for 2 min | warning |
| **High Current THD** | I-THD > 20% for 2 min | warning |
| **High Current Imbalance** | phase-current imbalance > 10% for 2 min | warning |

\* **The one number to tune.** `270` = 0.9 × 300 kVA placeholder. Edit the `[270]` in
`grafana/provisioning/alerting/ems-alerts.yaml` to `0.9 ×` your real contract kVA, then
`docker compose restart grafana`. (Alert rules can't read dashboard variables, so this is set in
the rule file.)

## Enabling real notifications (later)

To actually deliver alerts (email/Slack/Teams/Telegram), add an integration block to the
`ems-visual` contact point in `contactpoints.yaml` — e.g.:
```yaml
      - uid: ems-email
        type: email
        settings:
          addresses: ops@rucha-engineers.com
```
and set Grafana SMTP via env (`GF_SMTP_ENABLED=true`, `GF_SMTP_HOST=...`) in
`docker-compose.grafana.yml`. No alert-rule changes needed.

## Deploy
```bash
cd /opt/ems-edge-platform
git pull
docker compose restart grafana
```

## Verify
- Dashboards → **EMS** folder shows **4** dashboards, all rendering data.
- Alerting → **Alert rules** → 6 rules under "EMS Alerts", each Normal (or Firing on a real breach).
- Fire-test: `docker compose stop app`; after ~90 s "Meter offline" → Firing; `start app` → Normal.
