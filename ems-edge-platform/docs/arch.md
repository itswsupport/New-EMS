# Target Architecture — 500+ meters, 12+ plants

**Status: design, not built.** Nothing here is implemented yet. This is the shape to
build toward; `ems-ui` has already been written against the aggregation rules and the
topology seam in §4 so that adopting the rest is a swap, not a rewrite.

Companion to [architecture.md](architecture.md) (component structure) and
[scaling.md](scaling.md) (ingestion throughput). Neither covers the **read path**, the
**device registry**, or **multi-plant** — which is what breaks first at this scale.

---

## 1. Measured baseline

Not projections. Measured on the running system, 3 meters, 19 Aug 2026:

| | Measured |
|---|---|
| Rows | 1,286,173 over ~28 days |
| Size | 616 MB total (416 MB heap, 201 MB indexes) |
| Rate | ~46,400 rows/day for 3 meters → **~15,470 rows/meter/day** |
| 30-day cost aggregate | **472 ms** for 3 meters |
| Tenants / plants | 1 / 1 (`rucha-engineers` / `plant01`) |

### Extrapolated to 500 meters

| | Projected |
|---|---|
| Ingest | ~7.7M rows/day |
| Storage | ~3.7 GB/day → **~110 GB/month → ~1.3 TB/year** |
| Same 30-day aggregate | scans ~167× the data → **order of 80 seconds** |

Ingestion is fine — `scaling.md` shows a node handles thousands of meters, and at
12 plants there are 12 nodes. **The read path is what fails.** Every dashboard panel
currently runs `max(active_energy) - min(active_energy)` or `avg(active_power)`
directly against raw `energy_telemetry`.

Also blocking: the `pgvector/pgvector:pg16` image has **no TimescaleDB, no
pg_partman, no pg_cron** — `pg_available_extensions` offers only `vector` and
`btree_gist`.

---

## 2. Storage: TimescaleDB

Swap the image to **`timescale/timescaledb-ha:pg16`**, which still bundles pgvector,
so `plant_knowledge_base` and the existing vector migrations survive untouched.

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('energy_telemetry', 'timestamp',
                         chunk_time_interval => interval '1 day',
                         migrate_data => true);
```

**Continuous aggregates** at 1-minute, 15-minute, 1-hour and 1-day, each carrying per
device and bucket:

- `min`, `max`, `avg` of every instantaneous channel (power, PF, voltage, THD…)
- `first(active_energy, timestamp)` and `last(active_energy, timestamp)` for counters
- `count(*)` — the basis of a real data-availability metric

**Compression** after 7 days (`segmentby device_id, orderby timestamp DESC`) —
time-series of this shape typically gives 10–20×, which is what makes 1.3 TB/year
affordable. **Retention**: raw 90 days, aggregates indefinitely.

### Two things this fixes beyond speed

**Peak loss.** Today a chart buckets to `avg()` and then takes `max()` of those
means, so the displayed maximum *shrinks as the range widens* — a 30-day window
reported a lower peak than a 1-hour window inside it, which is arithmetically
impossible for a true maximum. A continuous aggregate stores the true per-bucket
`max`, so `max(max)` is correct at every zoom level.

**Energy maths.** `last() - first()` per bucket is the exact register difference over
that bucket. Summing bucket deltas is then correct even across a meter restart, and a
negative delta localises a counter wrap to a single bucket instead of poisoning a
whole range.

### Costs, stated plainly

- The primary key must include the partitioning column: `@@id([id, timestamp])`
  instead of `id`. A Prisma migration, and any code assuming a bare `id` PK changes.
- 1.29M rows migrate during `create_hypertable`. Do it in a maintenance window with
  ingestion stopped; the gateway buffers and the batch writer replays.
- One more moving part to operate — Timescale's background workers need
  `timescaledb.max_background_workers` sized for the number of aggregates.

---

## 2b. The Modbus poll path — the constraint that binds first

The database is the second bottleneck. The **poller** is the first, and it binds at a
far smaller fleet.

`apps/gateway-listener/src/poller.ts` walks devices sequentially and, until block
reads landed, issued **one request per register**, each awaited. Measured from the
ingest rate (15,470 rows/meter/day → a cycle every ~5.6 s for 3 devices × 24
registers): **~93 ms per round-trip**.

| Fleet | Requests/cycle (per register) | With block reads | Cycle at 93 ms |
|---|---|---|---|
| 3 devices (today) | 72 | 33 | 6.7 s → **3.1 s** |
| 5 devices | 120 | 55 | 11.2 s → **5.1 s** |
| 42 devices (one plant of 500) | 1,008 | 462 | 94 s → **43 s** |
| 500 devices | 12,000 | 5,500 | 19 min → **8.5 min** |

Block reads merge contiguous registers into one request — 24 registers on the LM1360
map collapse to 11 — and are implemented with `maxGap` defaulting to **0**, so no
unmapped address is ever read. That matters: on 2026-08-14 reading a single unmapped
address corrupted every other value in the same poll and destroyed four days of
energy data. A per-device `batch: false` opts a misbehaving meter out, and a failed
block falls back to per-register reads rather than nulling the device.

**Block reads alone do not reach 500 meters.** They buy roughly 2.2×, which unblocks
five devices and nothing like five hundred. Getting there needs, in rough order of
value:

1. **Concurrency.** The loop is strictly sequential — one outstanding request at a
   time — so a 93 ms round-trip is 93 ms of mostly idle waiting. Modbus TCP carries a
   transaction id, so requests to *different slaves* can be pipelined. Even 8-way
   concurrency turns the 500-meter cycle from 8.5 minutes to about a minute.
2. **One edge node per plant**, already the documented model in
   [scaling.md](scaling.md) — 12 nodes × ~42 meters is 43 s/cycle each, which
   concurrency then brings under the interval.
3. **Per-device poll intervals.** Not every meter needs 5-second resolution; a
   sub-meter on a lighting circuit is fine at a minute, which frees budget for the
   incomers that drive demand.
4. **Trim the register set.** Twenty-four registers per device is generous when the
   dashboards use a dozen.

Until concurrency lands, the practical ceiling per node is roughly 10–15 meters at a
5-second interval, or proportionally more at a longer one.

## 3. Device registry

`energy_telemetry` already carries `tenant_id` and `plant_id` with indexes on both,
and each edge node sets them from `DEFAULT_TENANT_ID` / `DEFAULT_PLANT_ID`
([env.schema.ts:47](../packages/config/src/env.schema.ts)). What is missing is
anywhere to record what a meter **is**, what it **feeds**, and what it **costs**.

```
plants
  id            text primary key          -- 'plant01'
  tenant_id     text not null
  name          text not null
  timezone      text not null default 'Asia/Kolkata'
  contract_kva  numeric                   -- service-point contract demand
  tariff_ref    text                      -- FK to a future tariff table

devices
  id              text primary key        -- 'meter11', matches telemetry.device_id
  plant_id        text not null references plants(id)
  parent_id       text references devices(id)   -- null = root / incomer
  path            text not null           -- materialised: 'meter11.meter07'
  name            text                    -- 'Compressor house feeder'
  kind            text                    -- incomer | feeder | machine
  ct_ratio        text                    -- measurement chain provenance
  accuracy_class  text
  cost_centre     text
  unique (plant_id, path)
```

**Who writes what.** Each edge node upserts **identity only** for its own devices at
boot, from its `devices.yaml` — `id`, `plant_id`, `tenant_id`. Twelve nodes therefore
self-register without anyone maintaining a central list. Topology (`parent_id`,
`path`) and commercial fields are owned by the registry and **never overwritten by
ingestion**, so a redeploy cannot flatten the tree.

**Why a materialised `path`.** Subtree rollup becomes `WHERE path <@ 'meter11'`
(ltree) or a prefix `LIKE`, evaluated once — instead of a recursive CTE per request
per panel. At 500 devices with unknown depth, that is the difference between a join
and a loop. Maintain `path` in a trigger on `parent_id` change; reject cycles there.

Until this lands, `ems-ui` reads the tree from `devices.yaml` behind
`src/lib/topology.ts` — see §4.

---

## 4. Aggregation rules

The contract. Both the UI and any future API implement exactly these. Getting them
wrong is what produced a plant total of double the truth.

1. **Plant total = sum over ROOT devices only.** A sub-meter's consumption is already
   inside its parent's reading; summing all devices double-counts. Measured here:
   `meter11 ÷ (meter07 + meter10)` = **1.0226** across 2,880 minute-buckets.
2. **A node's own load = node − Σ(direct children).** Report it as *unattributed* —
   distribution loss plus unmetered consumption. ~2.3% on meter11 today. This is the
   energy-balance number an auditor asks for.
3. **Billing belongs to the root.** The utility meters the service point. Sub-meter
   rupees are an **allocation** of that one bill, shown as a share, never summed.
4. **Contract demand applies at the service point**, never per sub-meter. A
   "meter07 is at 92% of contract" reading is meaningless and will be quoted as if it
   were not.
5. **Maximum demand is coincident.** Take the summed instantaneous load of the root
   set, average it over fixed clock-aligned blocks, then take the maximum block. The
   sum of each meter's individual peak is a different and larger number, because the
   peaks do not occur at the same time — keep it only as a diversity diagnostic.
6. **Reconcile on energy or ≥15-minute averages, never instantaneous values.**
   Minute-level parent/child ratios ranged 0.458–1.304 over 48h purely from poll skew
   between meters; the same ratio at hourly resolution sits at 1.04–1.10.

### The seam

`ems-ui/src/lib/topology.ts` is the only module that knows how topology is stored. It
exposes `getTopology(plantId)` → `{ nodes, roots, parentOf, childrenOf,
descendantsOf, isRoot }`. Today it parses `devices.yaml`; when §3 lands it queries
`devices`. Every query takes an explicit `deviceIds: string[]`, so multi-plant is a
different id set rather than new code.

---

## 5. Migration sequence

Ordered so each step is independently revertible and none is a big bang.

1. **Registry tables + backfill.** Create `plants` and `devices`; seed from the
   current `devices.yaml`. Nothing reads them yet.
2. **Point `topology.ts` at the registry.** One file changes in the UI. YAML parsing
   is deleted only after this is proven.
3. **Timescale image swap + hypertable.** Maintenance window, ingestion stopped.
   Verify row counts and a few known aggregates before and after.
4. **Continuous aggregates + compression + retention.** Additive; raw queries keep
   working throughout.
5. **Repoint the UI's bucketed reads at the aggregates.** Confined to
   `src/lib/queries.ts`. Compare each panel against the raw-table answer before
   switching.
6. **Ingestion upsert.** Add device self-registration to the edge node — last,
   because it is the only step needing an image rebuild on 12 nodes.

Steps 1–2 and 3–5 are independent; either order works.

---

## 6. Deliberately not solved here

**Authentication and tenant segregation.** Out of scope by explicit decision, and
fine while this is one plant on a trusted LAN. At 12 plants across tenants it stops
being a UI preference and becomes a data-segregation question: every page currently
serves plant data to anyone who can reach the port, and there is no record of who
changed a threshold or a contract value. Flagged here so the decision is made
knowingly rather than inherited by default.

Also out of scope and each its own project: tariff modelling (demand charges, TOD,
duty, the billing-demand ratchet), an alarm engine, IEEE 519 TDD/PCC compliance,
export and reporting, and the ISO 50001 baseline/EnPI layer.
