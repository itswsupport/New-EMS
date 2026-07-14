import { CrcError, ModbusExceptionError } from "@ems/common";
import type { ResolvedDevice } from "@ems/config";
import type { Logger } from "@ems/logger";
import {
  buildReadHoldingRequest,
  decodeRegisters,
  expectedReadResponseLength,
  parseReadResponse,
} from "@ems/modbus";
import { mapReadingsToRecord, validateTelemetry, type MetricReading } from "@ems/telemetry";
import type { PipelineHooks, TelemetrySink, Transactor } from "./types.js";

export interface PollerOptions {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

/**
 * DevicePoller — the Modbus MASTER loop for one connection.
 *
 * Per cycle, for every configured device, it reads each register (retrying
 * transient failures), decodes via the register decoder, maps readings to a
 * TelemetryRecord, validates it, and hands it to the sink (batch queue). This
 * class is pure orchestration over injected ports (Transactor, sink, hooks) and
 * is fully unit-testable with a fake Transactor.
 */
export class DevicePoller {
  #timer: NodeJS.Timeout | null = null;
  #running = false;
  #stopped = false;

  constructor(
    private readonly transactor: Transactor,
    private readonly devices: readonly ResolvedDevice[],
    private readonly sink: TelemetrySink,
    private readonly hooks: PipelineHooks,
    private readonly log: Logger,
    private readonly opts: PollerOptions,
  ) {}

  start(): void {
    if (this.#timer || this.#stopped) return;
    // Fire immediately, then on interval. Guard against overlap with #running.
    const tick = (): void => {
      if (this.#running || this.#stopped) return;
      void this.#cycle();
    };
    tick();
    this.#timer = setInterval(tick, this.opts.intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async #cycle(): Promise<void> {
    this.#running = true;
    const started = performance.now();
    try {
      for (const device of this.devices) {
        if (this.#stopped) break;
        await this.#pollDevice(device);
      }
    } finally {
      this.#running = false;
      this.hooks.onPollCycle(performance.now() - started);
    }
  }

  async #pollDevice(device: ResolvedDevice): Promise<void> {
    const readings: MetricReading[] = [];
    for (const reg of device.registers) {
      const value = await this.#readRegister(device.slave, reg.address, reg.quantity);
      let decoded: number | null = null;
      if (value) {
        // Discriminate on the literal `ok` flag — narrows reliably in both arms.
        const res = decodeRegisters(value, reg.datatype, reg.byteOrder, reg.scale);
        if (res.ok) {
          decoded = res.value;
        } else {
          this.hooks.onDecodeError(this.transactor.connectionId);
        }
      }
      readings.push({ metric: reg.metric, value: decoded });
    }

    const record = mapReadingsToRecord(
      { deviceId: device.id, tenantId: device.tenant, plantId: device.plant },
      readings,
      new Date(),
    );

    const validated = validateTelemetry(record);
    if (!validated.ok) {
      this.log.warn({ device_id: device.id, reason: validated.error.message }, "record rejected");
      return;
    }

    this.hooks.onFrameDecoded(this.transactor.connectionId);
    this.hooks.onRecordProduced(this.transactor.connectionId, device.tenant, device.plant);
    await this.sink(validated.value);
  }

  /** Read one register group with retry; returns payload bytes or null on failure. */
  async #readRegister(slave: number, address: number, quantity: number): Promise<Uint8Array | null> {
    const request = buildReadHoldingRequest(slave, address, quantity);
    const expected = expectedReadResponseLength(quantity);

    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      try {
        const frame = await this.transactor.transact(request, expected, this.opts.timeoutMs);
        const parsed = parseReadResponse(frame, slave);
        if (parsed.ok) {
          return parsed.value.data;
        }
        this.#accountError(parsed.error, slave); // retry on CRC/exception/short frame
      } catch (cause) {
        this.log.debug(
          { slave, address, attempt: attempt + 1, reason: (cause as Error).message },
          "register read failed",
        );
      }
    }
    return null;
  }

  #accountError(error: { code: string }, slave: number): void {
    if (error instanceof CrcError) {
      this.hooks.onCrcError(this.transactor.connectionId, slave);
    } else if (error instanceof ModbusExceptionError) {
      this.hooks.onModbusException(Number(error.context["exceptionCode"] ?? 0));
    } else {
      this.hooks.onDecodeError(this.transactor.connectionId);
    }
  }
}
