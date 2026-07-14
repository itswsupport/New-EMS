/**
 * mock-gateway.ts — a stand-in SenseLive X5050 for local testing WITHOUT real
 * hardware. It behaves like the real gateway: connects OUT to our listener as a
 * TCP client, and answers FC03 read requests with plausible float32 values.
 *
 * Run:  node --import tsx scripts/mock-gateway.ts [host] [port]
 * Then bring up the app and watch records flow.
 */
import { connect } from "node:net";
import { appendCrc } from "@ems/modbus";

const host = process.argv[2] ?? "127.0.0.1";
const port = Number(process.argv[3] ?? 4196);

// Plausible per-address values (matches config/devices.yaml register map).
const VALUES: Record<number, number> = { 0: 233.1, 6: 4.7, 52: 1085.4, 70: 50.02, 72: 18234.6 };

function floatResponse(slave: number, value: number): Uint8Array {
  const data = Buffer.alloc(4);
  data.writeFloatBE(value, 0);
  const adu = Uint8Array.from([slave, 0x03, 4, ...data]);
  return appendCrc(adu);
}

function jitter(base: number): number {
  // Deterministic-ish wobble from the clock so values look "live".
  return base * (1 + (Math.sin(Date.now() / 1000) * 0.01));
}

const socket = connect(port, host, () => {
  process.stdout.write(`mock-gateway connected to ${host}:${port}\n`);
});

socket.on("data", (req) => {
  if (req.length < 6 || req[1] !== 0x03) return;
  const slave = req[0]!;
  const address = (req[2]! << 8) | req[3]!;
  const value = jitter(VALUES[address] ?? 0);
  socket.write(Buffer.from(floatResponse(slave, value)));
});

socket.on("error", (err) => process.stderr.write(`mock-gateway error: ${err.message}\n`));
socket.on("close", () => {
  process.stdout.write("mock-gateway disconnected; retrying in 3s\n");
  setTimeout(() => process.exit(0), 3000);
});
