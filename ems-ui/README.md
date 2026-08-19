# EMS UI

A Next.js front end over the EMS edge platform's Postgres: **Plant Rollup**,
**Cost & Demand**, **Power Quality**, **Overview** (parity with the four Grafana
dashboards) and **Topology**.

It queries `ems-postgres` directly from server components — no changes to the
ingestion app, no new HTTP endpoints, no rebuild of anything that touches the meters.

## Running it on Windows

Postgres is deliberately **not published** on the EMS host; the compose stack keeps
it on the internal `ems-net` bridge. To develop against real data, forward it.

**1. On 192.168.100.30** — expose it to loopback only:

```bash
docker run -d --name pg-forward --network ems-net \
  -p 127.0.0.1:5432:5432 \
  alpine/socat tcp-listen:5432,fork,reuseaddr tcp-connect:ems-postgres:5432
```

**2. From Windows** — tunnel it:

```powershell
ssh -N -L 5432:127.0.0.1:5432 root@192.168.100.30
```

**3. Configure and run:**

```powershell
cd "d:\Rishikesh\New EMS\ems-ui"
copy .env.local.example .env.local   # then paste the real password
npm install
npm run dev
```

The password is at `/opt/ems-edge-platform/secrets/db_password.txt` on the host, or
`docker exec ems-postgres cat /run/secrets/db_password`.

Then open <http://localhost:3400>. If the tunnel isn't up, the app says so and shows
these steps rather than a stack trace.

Tear the forwarder down when you're finished: `docker rm -f pg-forward`.

## Deploying to the host

`docker-compose.ui.yml` adds it to the stack on `ems-net`, where it reaches
`postgres:5432` directly and no forwarding is needed:

```bash
cd /opt/ems-edge-platform
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
               -f docker-compose.grafana.yml -f docker-compose.ui.yml up -d ui
```

Served on `:3500`. Unlike the dashboards, this is a real image — changing the UI
means a rebuild, so it does need the host's npm access.

## What the numbers mean

The SQL is not a transcription of the Grafana panels. Three things are deliberately
different, each because the Grafana version was wrong:

**The day boundary is IST.** Postgres runs in `Etc/UTC` while every dashboard reads
in IST, so a bare `date_trunc('day', now())` rolls over at 05:30 IST. That silently
under-reported "energy today" by 60% — 2,397 kWh shown against 6,220 kWh actual.
Every day-bounded query here anchors to `Asia/Kolkata` explicitly.

**Power factor is a 15-minute average, not an instant.** Plant PF is genuinely
bimodal: roughly a third of samples sit near unity, the rest at 0.87–0.92. A 30-second
snapshot swings between 0.868 and 0.985 depending on which instant it lands on, and
reads as a fault that isn't there.

**kVAh is `kWh ÷ PF`, not `sqrt(kWh² + kVArh²)`.** The `reactive_energy` register is
the meter's *capacitive* counter, which barely moves on an inductive plant, so the
textbook form collapses to kWh and understates the bill by ~7%. The exact figure
needs the LM1360's own VAh counter, which is not yet mapped — see the register notes
in `ems-edge-platform/config/devices.yaml`.

One other departure: demand is shown as **bars with the plant total on top**, not a
gauge per meter. The 300 kVA contract applies to the whole supply, so a per-meter
gauge measured against it invites reading one meter as the plant.

### Known bad data

`active_energy` was corrupted between **2026-08-14 05:37 UTC and 2026-08-18 04:50 UTC**
by a register probe. Any range overlapping that window shows a banner; power, PF and
current in that span are fine.

## Design notes

The visual system is **lifted from `payroll-ui`** so the two apps read as one
product: shadcn "new-york" / neutral tokens, `--radius: 0.625rem`, Exo at a 12px
root, the `#2492AA` sidebar, lucide icons, the AdminLTE-ish `.table` classes, and
that project's house rule that display text is uppercase with form inputs exempt.
Tokens are copied verbatim from its `globals.css` rather than re-derived, so a
change there is a copy-paste away.

**One deliberate divergence: the chart palette.** payroll-ui's `--chart-3`
(`oklch(0.398 0.070 227)`) fails both the lightness band and the chroma floor on a
white surface — it reads gray — and `--chart-4` sits at 1.68:1 contrast. Neither can
carry a 2px line. Its `chart-1` and `chart-2` are kept and a violet third slot is
substituted; the trio validates all-pairs (worst CVD dE 14.8, normal-vision 27.3,
all above 3:1). Colour follows the meter, never its rank, so filtering never
repaints the survivors. Every chart carries a legend with direct last/max values
plus a table view, so nothing is encoded by colour alone.

Charts are hand-rolled SVG — about 300 lines for the one `TimeSeries` component
that serves 16 of the panels. payroll-ui uses Recharts, so that is a genuine
divergence in stack; it buys exact control over the mark and hover specs and one
less dependency, at the cost of a component the other team hasn't seen. Swapping to
Recharts later touches one file.

## Topology

`/topology` is bound directly to `config/devices.yaml` — the same register map the
poller reads — so what it shows is what the platform actually uses. Per device it
lists the live power, PF, today's own energy, the Modbus slave address and the
configured registers with their addresses and scale factors, arranged as the tree.

Two checks worth having as the fleet grows past a handful of meters:

- **Reporting but not declared** — a `device_id` writing telemetry that no entry in
  the register map claims. It belongs to no plant total and no allocation, so it is
  invisible everywhere else.
- **Declared but silent** — configured but nothing received in seven days.

Below the tree, each parent gets an energy balance against its children, with the
unattributed remainder. A negative remainder is called out explicitly: sub-meters
cannot exceed their parent, so it means the hierarchy or a CT ratio is wrong.

### Declaring the hierarchy

One optional key per device:

```yaml
  - id: meter11          # no parent -> root, the utility incomer
  - id: meter07
    parent: meter11
```

`deviceSchema` is a plain `z.object` with no `.strict()`, so zod strips `parent` and
the ingestion service ignores it — no migration and no rebuild. Nesting is arbitrary:
a child can have children. `src/lib/topology.ts` validates on load, rejecting a parent
that does not exist and catching cycles rather than hanging.

## Layout

```
src/lib/db.ts         pooled pg client (survives dev hot reload)
src/lib/queries.ts    every panel's SQL, one function each
src/lib/format.ts     units, IST timestamps, Indian digit grouping
src/lib/topology.ts   the meter tree — the ONLY module that knows how it is stored
src/components/       TimeSeries (SVG + crosshair), StatTile, DemandBars, MeterTree,
                      Distribution, Filters
src/app/              one route per section, including /topology
```

Adding a panel means one query function and one `<Panel>` — the chart component takes
`Series[]` and needs nothing else.
