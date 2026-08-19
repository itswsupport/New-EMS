import { CrcError, ModbusExceptionError } from "@ems/common";
import type { ResolvedDevice, ResolvedRegister } from "@ems/config";
import type { Logger } from "@ems/logger";
import { decodeRegisters, type ModbusCodec } from "@ems/modbus";
import { mapReadingsToRecord, validateTelemetry, type MetricReading } from "@ems/telemetry";
import type { PipelineHooks, TelemetrySink, Transactor } from "./types.js";

export interface PollerOptions {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Largest hole a block read may span, in registers. Defaults to 0. */
  readonly maxRegisterGap?: number;
}

/** Modbus caps a single read at 125 registers. */
const MAX_BLOCK_REGISTERS = 125;

/** One request covering a contiguous run, plus the registers it satisfies. */
interface ReadBlock {
  readonly address: number;
  readonly quantity: number;
  readonly registers: readonly ResolvedRegister[];
}

/**
 * Group registers into the fewest requests that read no unmapped addresses.
 *
 * One request per register is correct but slow: at ~93 ms a round-trip, twenty
 * registers is nearly two seconds per device, and the cycle time grows linearly
 * with the fleet. Contiguous runs collapse into one request each.
 *
 * `maxGap` defaults to 0 so only strictly adjacent registers merge. That is not
 * timidity — on 2026-08-14 reading a single unmapped address corrupted every
 * other value in the same poll and destroyed four days of energy data. Widen the
 * gap only against a register map you have actually confirmed.
 */
export function planReadBlocks(
  registers: readonly ResolvedRegister[],
  maxGap = 0,
): ReadBlock[] {
  if (registers.length === 0) return [];

  const sorted = [...registers].sort((a, b) => a.address - b.address);
  const blocks: ReadBlock[] = [];

  let start = sorted[0]!.address;
  let end = start + sorted[0]!.quantity; // exclusive
  let members: ResolvedRegister[] = [sorted[0]!];

  const flush = (): void => {
    blocks.push({ address: start, quantity: end - start, registers: members });
  };

  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i]!;
    const gap = r.address - end; // negative when registers overlap
    const wouldEnd = Math.max(end, r.address + r.quantity);

    if (gap <= maxGap && wouldEnd - start <= MAX_BLOCK_REGISTERS) {
      end = wouldEnd;
      members.push(r);
    } else {
      flush();
      start = r.address;
      end = r.address + r.quantity;
      members = [r];
    }
  }
  flush();
  return blocks;
}

/**
 * DevicePoller — the Modbus MASTER loop for one connection.
 *
 * Per cycle, for every configured device, it reads the registers in contiguous
 * blocks (retrying transient failures, falling back to one request per register
 * if a block fails), decodes via the register decoder, maps readings to a
 * TelemetryRecord, validates it, and hands it to the sink (batch queue). This
 * class is pure orchestration over injected ports (Transactor, sink, hooks) and
 * is fully unit-testable with a fake Transactor.
 *
 * Readings come back in address order rather than config order; the mapper keys
 * on metric name, so that is immaterial.
 */
export class DevicePoller {
  #timer: NodeJS.Timeout | null = null;
  #running = false;
  #stopped = false;

  constructor(
    private readonly transactor: Transactor,
    private readonly codec: ModbusCodec,
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
    const readings: MetricReading[] = device.batch
      ? await this.#readBlocks(device)
      : await this.#readEach(device.slave, device.registers);

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

  /** One request per contiguous block, falling back to per-register on failure. */
  async #readBlocks(device: ResolvedDevice): Promise<MetricReading[]> {
    const blocks = planReadBlocks(device.registers, this.opts.maxRegisterGap ?? 0);
    const readings: MetricReading[] = [];

    for (const block of blocks) {
      const payload = await this.#readRegister(device.slave, block.address, block.quantity);

      if (!payload) {
        // A whole block failing would null every metric in it, which is a much
        // bigger hole than one bad register. Degrade to the old behaviour.
        this.log.debug(
          { device_id: device.id, address: block.address, quantity: block.quantity },
          "block read failed, falling back to per-register",
        );
        readings.push(...(await this.#readEach(device.slave, block.registers)));
        continue;
      }

      for (const reg of block.registers) {
        // Payload is 2 bytes per register, big-endian, starting at block.address.
        const offset = (reg.address - block.address) * 2;
        const slice = payload.subarray(offset, offset + reg.quantity * 2);
        readings.push({
          metric: reg.metric,
          value: this.#decode(slice, reg),
        });
      }
    }
    return readings;
  }

  /** One request per register — the conservative path. */
  async #readEach(
    slave: number,
    registers: readonly ResolvedRegister[],
  ): Promise<MetricReading[]> {
    const readings: MetricReading[] = [];
    for (const reg of registers) {
      const value = await this.#readRegister(slave, reg.address, reg.quantity);
      readings.push({
        metric: reg.metric,
        value: value ? this.#decode(value, reg) : null,
      });
    }
    return readings;
  }

  #decode(data: Uint8Array, reg: ResolvedRegister): number | null {
    if (data.length < reg.quantity * 2) {
      this.hooks.onDecodeError(this.transactor.connectionId);
      return null;
    }
    // Discriminate on the literal `ok` flag — narrows reliably in both arms.
    const res = decodeRegisters(data, reg.datatype, reg.byteOrder, reg.scale);
    if (res.ok) return res.value;
    this.hooks.onDecodeError(this.transactor.connectionId);
    return null;
  }

  /** Read one register group with retry; returns payload bytes or null on failure. */
  async #readRegister(slave: number, address: number, quantity: number): Promise<Uint8Array | null> {
    const request = this.codec.buildReadHoldingRequest(slave, address, quantity);
    const expected = this.codec.expectedReadResponseLength(quantity);

    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      try {
        const frame = await this.transactor.transact(request, expected, this.opts.timeoutMs);
        const parsed = this.codec.parseReadResponse(frame, slave);
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
