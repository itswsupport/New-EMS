/**
 * scan-registers.ts — one-shot Modbus register-map scanner.
 *
 * The meter answers but its full register map is unknown. This tool reads a
 * contiguous block of holding registers off the LIVE meter and prints each
 * 2-register pair decoded as float32, so the map can be reverse-engineered by
 * matching known live values (voltage ~236, frequency ~50, power ~175000).
 *
 * It temporarily BECOMES the gateway listener, so the platform app must be
 * stopped first (only one thing can own the TCP port). It is READ-ONLY — it
 * never writes to the meter or the database.
 *
 * Usage (inside the app image, which has node + tsx + deps):
 *   docker compose stop app
 *   docker compose run --rm --service-ports app \
 *     node --import tsx scripts/scan-registers.ts <slave> <start> <count> [chunk]
 *   docker compose start app
 *
 * Example: scan registers 0..119 of slave 7 in 20-register chunks
 *   ... scripts/scan-registers.ts 7 0 120 20
 */
import { createServer, type Socket } from "node:net";
import { loadEnv } from "@ems/config";
import { createModbusCodec, decodeRegisters, FrameDecoder } from "@ems/modbus";

const env = loadEnv();
const SLAVE = Number(process.argv[2] ?? 7);
const START = Number(process.argv[3] ?? 0);
const COUNT = Number(process.argv[4] ?? 120);
const CHUNK = Number(process.argv[5] ?? 20); // registers per read (keep <= 125)
const codec = createModbusCodec(env.MODBUS_FRAMING);

function log(o: unknown): void {
  process.stdout.write(JSON.stringify(o) + "\n");
}

/** One request/response transaction over the accepted gateway socket. */
function transact(
  socket: Socket,
  decoder: FrameDecoder,
  request: Uint8Array,
  expectedLen: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer): void => {
      decoder.push(chunk);
      const frame = decoder.takeFrame(expectedLen);
      if (frame) {
        cleanup();
        resolve(frame);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      decoder.reset();
      reject(new Error("timeout"));
    }, timeoutMs);
    function cleanup(): void {
      clearTimeout(timer);
      socket.off("data", onData);
    }
    socket.on("data", onData);
    socket.write(request);
  });
}

async function scan(socket: Socket): Promise<void> {
  const decoder = new FrameDecoder();
  log({ msg: "scan starting", slave: SLAVE, start: START, count: COUNT, byteOrder: env.MODBUS_BYTE_ORDER });

  for (let addr = START; addr < START + COUNT; addr += CHUNK) {
    const qty = Math.min(CHUNK, START + COUNT - addr);
    const req = codec.buildReadHoldingRequest(SLAVE, addr, qty);
    const expected = codec.expectedReadResponseLength(qty);
    let frame: Uint8Array;
    try {
      frame = await transact(socket, decoder, req, expected, env.MODBUS_TIMEOUT_MS);
    } catch (e) {
      log({ addr, error: (e as Error).message });
      continue;
    }
    const parsed = codec.parseReadResponse(frame, SLAVE);
    if (!parsed.ok) {
      log({ addr, qty, parseError: parsed.error.message });
      continue;
    }
    const data = parsed.value.data;
    for (let i = 0; i + 4 <= data.length; i += 4) {
      const a = addr + i / 2;
      const slice = data.subarray(i, i + 4);
      const res = decodeRegisters(slice, "float32", env.MODBUS_BYTE_ORDER);
      log({
        addr: a,
        float: res.ok && Number.isFinite(res.value) ? Number(res.value.toFixed(3)) : null,
        hex: Buffer.from(slice).toString("hex"),
      });
    }
  }
  log({ msg: "scan complete" });
}

const server = createServer((socket) => {
  log({ msg: "gateway connected", remote: `${socket.remoteAddress}:${socket.remotePort}` });
  scan(socket)
    .catch((e) => log({ msg: "scan failed", error: (e as Error).message }))
    .finally(() => {
      socket.destroy();
      server.close();
      setTimeout(() => process.exit(0), 200);
    });
});

server.listen(env.GATEWAY_LISTEN_PORT, env.GATEWAY_LISTEN_HOST, () => {
  log({ msg: "scanner listening — waiting for the gateway to dial in", port: env.GATEWAY_LISTEN_PORT });
});
