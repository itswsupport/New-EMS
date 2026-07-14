# ems-edge — Network & Gateway

## 1. Addresses

| Element           | Value              | Notes                                   |
|-------------------|--------------------|-----------------------------------------|
| Gateway (X5050)   | `192.168.6.56`     | Modbus TCP server                       |
| Gateway TCP port  | `4196`             | Default SenseLive transparent port      |
| MQTT broker (host)| `localhost:1883`   | From the edge host / your laptop        |
| MQTT broker (net) | `mosquitto:1883`   | From inside `ems-net` (Telegraf uses this) |

## 2. Serial side (gateway → meters)

The X5050 performs **Modbus TCP → Modbus RTU** conversion. The serial line
parameters are configured **on the gateway itself**, not in Telegraf:

| Setting   | Value   |
|-----------|---------|
| Baud rate | 9600    |
| Data bits | 8       |
| Parity    | None    |
| Stop bits | 1       |
| Wiring    | RS-485 A/B twisted pair, common ground, 120Ω termination at line ends |

Meters share the bus and are addressed by **slave ID**: `7`, `10`, `11`.

## 3. Gateway (X5050) configuration checklist

Log into the X5050 web UI / config tool and confirm:

1. **Work mode:** Modbus TCP Server (a.k.a. "TCP Server" / "Modbus Gateway").
2. **Local port:** `4196`.
3. **Serial:** `9600 / 8 / None / 1` matching the meters.
4. **Response timeout:** ≥ 1000 ms (RS-485 chains can be slow).
5. Static IP `192.168.6.56` on the plant OT subnet.

## 4. Connectivity tests

```bash
# From the edge host — is the gateway reachable on the OT network?
ping 192.168.6.56

# Is the Modbus TCP port open?
nc -zv 192.168.6.56 4196

# Full Modbus read test (see README "Modbus testing")
docker run --rm --network ems-net dersimn/modbus-tools \
  modbus-cli -h 192.168.6.56 -p 4196 ...
```

## 5. Firewall / segmentation guidance

- Keep the OT subnet (meters + gateway) isolated from IT/office LAN.
- The edge host should have **one leg on the OT subnet** (to reach the gateway)
  and its uplink to cloud on a separate, firewalled interface.
- Only outbound 8883 (MQTT/TLS) should be permitted toward the cloud once the
  cloud bridge is added; nothing inbound from the internet.
