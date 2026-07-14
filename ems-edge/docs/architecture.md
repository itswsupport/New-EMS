# ems-edge — Architecture

## 1. Purpose

`ems-edge` is a per-site **Industrial IoT edge node**. It collects electrical
energy data from Modbus meters behind a SenseLive X5050 serial-to-Ethernet
gateway, normalizes it to JSON, and publishes it to a local MQTT broker. The
broker is the integration seam for the next stage (cloud bridge, local
historian, SCADA, etc.).

One `ems-edge` stack runs per gateway/factory. The design is intended to be
**replicated across hundreds of gateways** by changing only `.env`.

## 2. Data flow

```
 ┌─────────────┐   Modbus RTU     ┌──────────────┐   Modbus TCP    ┌───────────┐
 │  LM1360      │ 9600 8N1 RS-485 │  SenseLive    │  :4196          │ Telegraf   │
 │  meters      ├────────────────►│  X5050        ├────────────────►│ (modbus    │
 │  SID 7/10/11 │                 │  gateway      │  TCP→RTU bridge │  input)    │
 └─────────────┘                 └──────────────┘                 └─────┬─────┘
                                                                        │ JSON
                                                                        ▼
                                                                 ┌───────────┐
                                                                 │ Mosquitto  │
                                                                 │  :1883     │
                                                                 └─────┬─────┘
                                                                        │ MQTT
                                                                        ▼
                                                          ems/plant01/meter07
                                                          ems/plant01/meter10
                                                          ems/plant01/meter11
                                                                        │
                                                                        ▼
                                                       (future) cloud bridge / TLS
```

## 3. Components

| Component  | Image                 | Role                                             |
|------------|-----------------------|--------------------------------------------------|
| Mosquitto  | `eclipse-mosquitto:2` | Local MQTT broker, persistence + logging         |
| Telegraf   | `telegraf:1.30`       | Modbus polling, JSON conversion, MQTT publishing |

Both run as containers on a dedicated `ems-net` bridge network. Telegraf
resolves the broker by the DNS name `mosquitto`.

## 4. Register model (Rishabh LM1360)

Each parameter is read as a **32-bit IEEE-754 float** occupying two consecutive
holding registers (Modbus function code 3).

| Parameter | Start register | Registers  | Unit (typical) |
|-----------|----------------|------------|----------------|
| Voltage   | 0              | 0–1        | V              |
| Current   | 6              | 6–7        | A              |
| Power     | 52             | 52–53      | W / kW         |
| Energy    | 72             | 72–73      | kWh            |

> **Byte order** defaults to `ABCD`. If values are implausible, cycle through
> `CDAB → DCBA → BADC` in `configs/telegraf/telegraf.conf`. This is expected
> commissioning work — different firmware revisions differ.

## 5. Topic & payload contract

- **Topic:** `ems/<PLANT_ID>/meter<NN>` (e.g. `ems/plant01/meter07`)
- **Payload:** JSON produced by Telegraf, e.g.

```json
{
  "fields": { "voltage": 239.8, "current": 4.12, "power": 985.0, "energy": 15230.5 },
  "name": "energy",
  "tags": {
    "meter": "meter07", "slave_id": "7",
    "plant": "plant01", "tenant": "rucha-group",
    "gateway": "senselive-x5050", "host": "telegraf"
  },
  "timestamp": 1700000000000
}
```

## 6. Scaling model

- **Vertical (per site):** add more `[[inputs.modbus]]` blocks for extra slaves.
- **Horizontal (many sites):** deploy the same compose stack per gateway; set a
  unique `PLANT_ID`/`TENANT_ID` per node so topics and client IDs stay unique.
- **Fleet management:** because everything is config-as-code, the stack is a
  natural fit for GitOps / Ansible / Balena / Azure IoT Edge rollout.

## 7. Reliability characteristics

- `restart: unless-stopped` keeps services alive across crashes and reboots.
- Mosquitto **persistence** retains queued QoS-1 messages across restarts.
- Telegraf **metric buffer** (`metric_buffer_limit`) absorbs short broker
  outages without losing samples.
- Container **healthchecks** allow orchestrators to auto-heal.
