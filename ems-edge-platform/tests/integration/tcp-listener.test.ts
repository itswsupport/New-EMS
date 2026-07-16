import { describe, it, expect, afterEach } from "vitest";
import { connect, type Socket } from "node:net";
import { GatewayServer } from "@ems/gateway-listener";
import type { PipelineHooks } from "@ems/gateway-listener";
import type { ResolvedDevice } from "@ems/config";
import type { TelemetryRecord } from "@ems/telemetry";
import { createLogger } from "@ems/logger";
import { buildFloatResponse } from "../helpers/modbus-frame.js";

const log = createLogger({ level: "silent", service: "test" });
const noopHooks: PipelineHooks = {
  onFrameDecoded: () => {}, onCrcError: () => {}, onModbusException: () => {},
  onDecodeError: () => {}, onRecordProduced: () => {}, onPollCycle: () => {},
};
const device: ResolvedDevice = {
  id: "meter07", slave: 7, tenant: "rucha", plant: "plant01", functionCode: 3,
  registers: [{ metric: "voltage", address: 0, quantity: 2, datatype: "float32", byteOrder: "ABCD", scale: 1 }],
};

let server: GatewayServer | null = null;
let client: Socket | null = null;
afterEach(async () => {
  client?.destroy();
  await server?.close();
});

describe("GatewayServer TCP listener (client-initiated, like the X5050)", () => {
  it("accepts a gateway connection and ingests a decoded record", async () => {
    const produced: TelemetryRecord[] = [];
    const port = 45_196; // fixed high port for the test

    server = new GatewayServer(
      { host: "127.0.0.1", port, maxConnections: 4, connectionTimeoutMs: 5000,
        rateLimitPerMin: 100, intervalMs: 10_000, timeoutMs: 1000, maxRetries: 1, framing: "rtu" },
      { devices: [device], sink: async (r: TelemetryRecord) => void produced.push(r), hooks: noopHooks, log,
        onOpen: () => {}, onClose: () => {} },
    );
    await server.listen();

    // Mock gateway = TCP CLIENT that dials the listener and answers FC03 reads.
    await new Promise<void>((resolve, reject) => {
      client = connect(port, "127.0.0.1", () => resolve());
      client.on("error", reject);
      client.on("data", () => {
        client!.write(Buffer.from(buildFloatResponse(7, 230.5)));
      });
    });

    // Wait for at least one poll->response->record round trip.
    await waitFor(() => produced.length >= 1, 3000);
    expect(produced[0]?.voltage).toBeCloseTo(230.5, 2);
    expect(server.activeConnections()).toBe(1);
  });
});

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}
