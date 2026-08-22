# EMS Commissioning Playbook

**Audience:** anyone bringing up this platform on a **new plant**, adding a **new meter**, or
onboarding a **new meter brand**. It distills what this project learned the expensive way so the
next deployment doesn't repeat it. Pair it with [architecture.md](architecture.md),
[server-setup.md](server-setup.md), and [dashboards.md](dashboards.md).

---

## 0. The Golden Rule (read this first)

> **Never explore an unknown register map by editing `config/devices.yaml` against the live plant.**
> Use **`scripts/scan-registers.ts`**, which reads the meter **without writing to the database.**

Why this is Rule #0: on **2026-08-14** someone moved `reactive_energy` from register 76 → 78 in
`devices.yaml` to test a hypothesis. Register 78 (unmapped on these units) **corrupted other
registers in the same poll** — `active_energy` at 72 started returning garbage, and **four days of
energy and cost data were destroyed** (window 2026-08-14 05:37 → 2026-08-18 04:50 UTC) before it was
caught and reverted. The live config feeds the database. A guess in it is a guess written to
production. **Probe read-only, confirm, *then* edit.**

---

## 1. What this platform is

A per-site edge node: the serial-to-Ethernet **gateway dials into us** (TCP client), we act as the
**Modbus master**, decode meter registers into typed telemetry, batch-write to **PostgreSQL +
pgvector**, and serve **Grafana** dashboards + alerts. One process per plant; scale by `.env` +
`devices.yaml`. Config changes are a **`docker compose restart app`** (no rebuild); schema changes
need a rebuild.

---

## 2. Bring up a NEW plant / server (condensed)

Full detail in [server-setup.md](server-setup.md). The essentials:

1. **Reach the gateway first** — `ping <gateway-ip>`. If you can't see it, it can't dial you.
2. **Docker Engine** (not Desktop — free on Linux). Clone to `/opt/…`, symlink to `/opt/ems-edge-platform`.
3. **Secrets** (`secrets/*.txt`) — `chmod 0444` the files, `0700` the dir. *Not* `0600` — the app runs
   as non-root `node` (uid 1000) and a root-owned `0600` secret is unreadable inside the container.
4. **`.env`** — set `PLANT_ID`, `MODBUS_FRAMING` (§4.1), bind IPs. Optionally
   `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.grafana.yml` so you never
   type `-f` flags. (This is safe now — see the COMPOSE_FILE trap in §8.)
5. `docker compose up -d --build` → `migrate` runs → `app` + `grafana` start.
6. **Point the gateway at us**: TCP Client, destination `<server-ip>:4196`, and for the SenseLive
   X5050 **Connection control = Startup/None** (else it waits for the meter to speak first and never
   connects).
7. Lock the firewall via the **`DOCKER-USER`** iptables chain (not `ufw` — Docker bypasses it), scoped
   to port 4196 from the gateway IP only.

---

## 3. Add a NEW meter — the process

Do these in order. Skipping the scan is how you lose data.

1. **Wire it** to the RS-485 bus: A/B twisted pair, common ground, 120 Ω termination at both bus ends,
   a **unique slave ID**. All meters on one bus must share baud/parity (9600 8N1).
2. **Confirm it answers.** If it's on a fresh drop, watch the gateway's **serial RX LED** while polling
   — TX-only-blinking = your request goes out, nothing comes back. #1 cause: **A/B reversed** — swap
   them (this exact fix un-stuck meter07).
3. **Scan its registers read-only:**
   ```bash
   docker compose stop app
   docker compose run --rm --service-ports -v "$PWD/scripts:/app/scripts:ro" \
     app node --import tsx scripts/scan-registers.ts <slave> <start> <count> <chunk>
   docker compose start app
   ```
   Match the printed floats against known live values (voltage ~230, frequency ~50, power) to
   identify each address. This is how the whole LM1360 map was reverse-engineered.
4. **Add it to `devices.yaml`** with only the addresses you *confirmed*, then `docker compose restart app`.
5. **Verify with physics** (§5) before trusting the numbers.

To find a meter's **slave ID** if unknown, sweep with the scanner across candidate IDs (1–20) and see
which answers.

---

## 4. The four gotchas that each cost real pain

Every new meter hits some subset of these. Know the symptom → fix.

### 4.1 Framing — `tcp` vs `rtu`
- **`tcp` (MBAP):** gateway is a **Modbus gateway** that converts TCP↔RTU (SenseLive X5050 in
  "Modbus TCP to RTU"). We send a 12-byte MBAP request, no CRC.
- **`rtu`:** gateway is a **transparent** serial tunnel (basic MOXA NPort 5130) — we own RTU framing +
  CRC16.
- **Symptom of wrong choice:** connection is up, TCP-ACKs flow, but **every read times out / no data**.
- Set per-node in `.env` `MODBUS_FRAMING`.
- **Also:** a Modbus gateway **reassigns the MBAP transaction id** on the reply — it never matches ours.
  Our TCP codec deliberately does **not** verify the transaction id (correlation is by ordering, since
  requests are serialized). Don't "fix" that check back.

### 4.2 Byte order — `ABCD` / `CDAB` / `DCBA` / `BADC`
- float32 spans two registers; vendors disagree on word/byte order.
- **LM1360 = `ABCD`. Secure Elite 103 = `CDAB`** (its manual says "(LSR)-(MSR)", least-significant
  register first — the opposite of the LM1360).
- **Symptom:** values decode but are absurd (0, NaN, 1e38, tiny). Cycle `ABCD → CDAB → DCBA → BADC`
  until voltage reads ~230–240 and frequency ~50. Set per-register `byteOrder:` (or per-brand default).

### 4.3 Energy unit — Wh vs kWh (the silent 1000×)
- Energy counters' unit depends on the meter's **CT/PT ratio / energy-unit setting** — it can differ
  **meter to meter of the same model.** On this plant: meter07 counts in **Wh**, meter10 & 11 in
  **kWh** (1000× coarser). Power/demand are always base units (W/VA), so only energy diverges.
- **Symptom:** energy/cost reads ~1000× too low (or high) for one meter vs its neighbours.
- **Confirm it with the physics check (§5), never by eyeballing magnitudes** — magnitude-guessing is
  what cost four days of data.
- **Fix:** add `scale: 1000` to that meter's `active_energy` + `reactive_energy` (normalises to Wh).
  When you first apply it, one-time `UPDATE energy_telemetry SET active_energy=active_energy*1000,
  reactive_energy=reactive_energy*1000 WHERE device_id IN (...)` **with the app stopped** so historical
  rows match and there's no step discontinuity.
- The Elite 103 exposes its unit in **register 82 (Modbus Resolution: 0=none,1=kilo,2=mega,3=giga)** —
  **read it**, don't infer.

### 4.4 Reactive-energy counter — capacitive vs inductive
- Multifunction meters keep **two** reactive-energy counters: **inductive (lag)** and **capacitive
  (lead)**. An industrial (inductive) plant accumulates almost nothing in the capacitive counter.
- **On the LM1360, address 76 is the CAPACITIVE counter** — it reads ~0-ish (16–800× too slow vs
  `kWh × tan φ`), so **kVAh billing cannot be built from it.** It's left mapped because it's *safe*, not
  because it's right. The true inductive VArh counter and the VAh counter are still **unconfirmed** —
  resolve them with the scanner, never by editing the live map (that's the 2026-08-14 incident).
- On the **Elite 103**, address 228 = **LAG/inductive** (use this); 230 = **Lead/capacitive** (do *not*).
- **kVAh cost** is currently computed `√(kWh² + kVArh²)` from the reliable active + (capacitive)
  reactive counters — an approximation. For bill-exact kVAh, read the meter's own VAh counter once
  it's confidently identified.

---

## 5. The verification recipe (physics, not vibes)

After adding/scaling any energy register, **confirm energy tracks power** over a window:

```bash
docker compose exec -T postgres psql -U ems -d ems -c "SELECT device_id, count(*),
  round(((max(active_energy)-min(active_energy)))::numeric,0) AS delta,
  round((avg(active_power))::numeric,0) AS avg_w
  FROM energy_telemetry WHERE timestamp > now() - interval '20 min' GROUP BY device_id ORDER BY 1;"
```

`delta ÷ (avg_w × hours)` tells you the unit: **≈1000 → counter is Wh**, **≈1 → counter is kWh**.
If a meter's ratio doesn't match its neighbours, its energy unit is off — go to §4.3. This one check
would have caught every energy bug on this project in seconds.

---

## 6. Per-brand register maps (confirmed)

The live, working addresses. **Do not reuse one brand's anchor for another.**

### Rishabh LM1360 — `ABCD`, FC03 float32
V avg `42` / L1-3 `0,2,4` · I avg `46` / `6,8,10` · P total `52` / L1-3 `12,14,16` · VA `56` · VAr `58`
· PF `62` / `30,32,34` · freq `70` · **active_energy `72`** (Wh; kWh meters `scale:1000`) ·
reactive_energy `76` *(capacitive — see §4.4)* · V-THD `218` · I-THD `220` · **max_demand `102`** (VA).

### Secure Elite 103 — `CDAB`, FC03 float32
V avg `106` / L1-3 `100,102,104` · I avg `334` / `114,116,118` · P `148` / `142,144,146` · VA `164` ·
VAr `156` · PF `140` / `134,136,138` · freq `172` · active_energy `200` *(inferred — confirm it climbs)*
· reactive_energy `228` *(LAG/inductive)* · V-THD `178` · I-THD `184` · max_demand `304`.
**Caveats:** only the **-103** variant has Modbus (check the nameplate); the manual's HEX vs 4xxxx
numbers differ by one (`printed = 40000 + HEX`; addresses here are the HEX value); energy unit is in
register 82.

---

## 7. `devices.yaml` config reference

| Field | Level | Meaning |
|---|---|---|
| `slave` | device | Modbus slave/unit id |
| `tenant` / `plant` | device | tagged onto every row (multi-tenant/site) |
| `parent` | device | topology — a device with **no `parent` is the ROOT** (utility incomer); others hang beneath it. Enables incomer-vs-subload rollups. |
| `batch` | device | default `true` — merge contiguous registers into block reads (fewer Modbus transactions per cycle). |
| `registers.<metric>.address` | register | 0-based protocol address (float32 pair) |
| `registers.<metric>.byteOrder` | register | overrides the meter/global default (`ABCD`…`DCBA`) |
| `registers.<metric>.scale` | register | multiply decoded value (e.g. `1000` kWh→Wh) |
| `registers.<metric>.quantity` / `datatype` | register | default 2 / float32 |
| `MODBUS_MAX_REGISTER_GAP` | `.env` | how many unused registers block-read may span to still merge two reads into one |

Metric keys must match the schema (`voltage`, `current`, `active_power`, …, `maximum_demand`); unknown
keys are ignored, so a typo silently drops a value — verify after every edit.

---

## 8. Operational gotchas (bit us, now fixed — don't reintroduce)

- **`COMPOSE_FILE` trap:** the app's `*_FILE` secret loader once treated Docker's own `COMPOSE_FILE`
  env var as a secret path and **crash-looped the app**. Fixed — only `*_FILE` for keys the app
  actually uses are read. Safe to keep `COMPOSE_FILE` in `.env`.
- **Secret file perms:** `0444` on the file, `0700` on `secrets/`. `0600` = `EACCES` in the non-root
  container (§2.3).
- **IST day boundary:** Postgres runs UTC; a bare `date_trunc('day', now())` rolls over at **05:30
  IST** and under-reports "today". Use `AT TIME ZONE 'Asia/Kolkata'` (see the plant-rollup "Energy
  today" panel).
- **Bimodal PF:** plant PF is genuinely bimodal (~35% of samples near unity, rest 0.87–0.92), so a
  30-second snapshot swings and false-alarms. Aggregate PF panels use a **15-min load-weighted** value.
- **kVAh billing:** Maharashtra tariffs bill **apparent energy (kVAh) @ ₹10.5**, not kWh — cost =
  `√(kWh² + kVArh²) × tariff`. kVAh inherently charges for poor PF.
- **Grafana alerting:** provisioned alert rules are strict — a malformed **mute timing crash-looped
  Grafana** once. Alerts are visual-only via a no-op contact point; test any alerting-YAML change
  against a throwaway Grafana before shipping. Dashboards auto-reload; **alert rules need
  `docker compose restart grafana`.**
- **pgAdmin / DB access:** Postgres is internal-only (no host port) by design. To connect a GUI, publish
  to **loopback only** (`127.0.0.1:5432`) or SSH-tunnel — never expose 5432 on the LAN.

---

## 9. Incident log (the scars)

| Date (UTC) | What | Root cause | Lesson |
|---|---|---|---|
| 2026-08-14 → 08-18 | 4 days of energy/cost data corrupted | probed register 78 live in `devices.yaml`; unmapped register misaligned the poll and garbled register 72 | **Rule #0** — scan read-only, never probe in the live config |
| (commissioning) | meter reported nothing despite good TCP | RS-485 **A/B reversed** | swap A/B; watch the serial RX LED |
| (commissioning) | every valid reply rejected | gateway **reassigns MBAP transaction id** | don't verify txn id when a gateway converts TCP↔RTU |
| (commissioning) | 2 meters read energy 1000× low | **kWh vs Wh** unit differs per meter | confirm with the §5 physics check; `scale: 1000` |
| (ops) | app crash-loop after a config tweak | `COMPOSE_FILE` treated as a secret | scope `*_FILE` handling to known keys |
| (ops) | Grafana crash-loop | malformed provisioned mute timing | test alerting YAML before shipping |

---

**The one-line summary for the next engineer:** the software is solved; **every remaining risk lives
in the meter's register map and its units.** Discover them read-only with `scan-registers.ts`, confirm
with the physics check, and only then write them into the live config.
