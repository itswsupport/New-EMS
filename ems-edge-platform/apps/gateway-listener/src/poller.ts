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
  /** Circuit breaker: after this many consecutive all-BAD polls, a slave is put
      in cooldown and skipped, so one dead meter can't stall the serial cycle. */
  readonly slaveFailThreshold: number;
  /** How many cycles a cooling slave is skipped before it is re-probed once. */
  readonly slaveCooldownCycles: number;
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

  // Per-slave circuit breaker. A slave whose poll yields only null (quality BAD)
  // this many cycles running is skipped until #coolingUntil, then probed once.
  #cycleCount = 0;
  readonly #failures = new Map<number, number>();
  readonly #coolingUntil = new Map<number, number>();

  // Per-REGISTER breaker (same thresholds, keyed "slave:address"). A single
  // register that fails `slaveFailThreshold` cycles running is skipped — its
  // metric reads null, no bus cost — until re-probed after `slaveCooldownCycles`.
  // So a partially-dead meter (one bad/unmapped register → UNCERTAIN) can't pay
  // retries*timeout on that register every cycle while its good registers keep
  // polling fast; the per-slave breaker only catches a fully-dead meter.
  readonly #regFailures = new Map<string, number>();
  readonly #regCoolingUntil = new Map<string, number>();

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
      // A cycle must never reject unhandled: the sink throws "queue is closed"
      // if shutdown begins mid-poll, which would otherwise kill the process.
      void this.#cycle().catch((cause: unknown) => {
        this.log.warn({ reason: (cause as Error).message }, "poll cycle failed");
      });
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
        // Skip a cooling-down slave so a dead meter's timeouts don't stall the
        // whole serial cycle; it is re-probed once when the cooldown expires.
        if (this.#cycleCount < (this.#coolingUntil.get(device.slave) ?? 0)) continue;
        const ok = await this.#pollDevice(device);
        this.#updateBreaker(device, ok);
      }
    } finally {
      this.#cycleCount++;
      this.#running = false;
      this.hooks.onPollCycle(performance.now() - started);
    }
  }

  /** Poll one device. Returns true if it produced usable data (quality != BAD). */
  async #pollDevice(device: ResolvedDevice): Promise<boolean> {
    // Read only the registers not in per-register cooldown; cooled ones read
    // null (skipped this cycle, re-probed when their cooldown expires).
    const active = device.registers.filter((r) => !this.#regCooling(device.slave, r.address));
    const readings: MetricReading[] = active.length
      ? device.batch
        ? await this.#readBlocks(device, active)
        : await this.#readEach(device.slave, active)
      : [];
    for (const reg of device.registers) {
      if (this.#regCooling(device.slave, reg.address)) readings.push({ metric: reg.metric, value: null });
    }
    this.#updateRegisterBreakers(device, active, readings);

    const record = mapReadingsToRecord(
      { deviceId: device.id, tenantId: device.tenant, plantId: device.plant },
      readings,
      new Date(),
    );

    const validated = validateTelemetry(record);
    if (!validated.ok) {
      this.log.warn({ device_id: device.id, reason: validated.error.message }, "record rejected");
      return false;
    }

    this.hooks.onFrameDecoded(this.transactor.connectionId);
    this.hooks.onRecordProduced(this.transactor.connectionId, device.tenant, device.plant);
    await this.sink(validated.value);
    return validated.value.quality !== "BAD";
  }

  /**
   * Circuit breaker: a slave that returns only null (quality BAD) for
   * `slaveFailThreshold` cycles running is put in cooldown and skipped for
   * `slaveCooldownCycles` cycles, then probed once. Recovery resets it. WARNs on
   * trip and recovery so a dead meter is visible in the default (info) log.
   */
  #updateBreaker(device: ResolvedDevice, ok: boolean): void {
    const slave = device.slave;
    if (ok) {
      if ((this.#failures.get(slave) ?? 0) > 0 || this.#coolingUntil.has(slave)) {
        this.log.warn({ slave, device_id: device.id }, "slave recovered — resuming normal polling");
      }
      this.#failures.delete(slave);
      this.#coolingUntil.delete(slave);
      return;
    }
    const failures = (this.#failures.get(slave) ?? 0) + 1;
    this.#failures.set(slave, failures);
    if (failures >= this.opts.slaveFailThreshold) {
      const wasCooling = this.#coolingUntil.has(slave);
      this.#coolingUntil.set(slave, this.#cycleCount + 1 + this.opts.slaveCooldownCycles);
      if (!wasCooling) {
        this.log.warn(
          { slave, device_id: device.id, failures, cooldown_cycles: this.opts.slaveCooldownCycles },
          "slave returning no data — cooling down (will re-probe periodically)",
        );
      }
    }
  }

  #regCooling(slave: number, address: number): boolean {
    return this.#cycleCount < (this.#regCoolingUntil.get(`${slave}:${address}`) ?? 0);
  }

  /**
   * Per-register circuit breaker, updated from this cycle's active reads. Mirrors
   * the per-slave one at register granularity: a register whose value comes back
   * null (unreadable or undecodable) for `slaveFailThreshold` cycles running is
   * cooled and skipped; a good read resets it. A null value that is due to the
   * register being skipped is not re-counted (only `active` registers are seen).
   */
  #updateRegisterBreakers(
    device: ResolvedDevice,
    active: readonly ResolvedRegister[],
    readings: readonly MetricReading[],
  ): void {
    const byMetric = new Map(readings.map((r) => [r.metric, r.value]));
    for (const reg of active) {
      const key = `${device.slave}:${reg.address}`;
      const value = byMetric.get(reg.metric);
      if (value === null || value === undefined) {
        const failures = (this.#regFailures.get(key) ?? 0) + 1;
        this.#regFailures.set(key, failures);
        if (failures >= this.opts.slaveFailThreshold) {
          const wasCooling = this.#regCoolingUntil.has(key);
          this.#regCoolingUntil.set(key, this.#cycleCount + 1 + this.opts.slaveCooldownCycles);
          if (!wasCooling) {
            this.log.warn(
              { slave: device.slave, device_id: device.id, address: reg.address, metric: reg.metric, failures },
              "register returning no data — cooling down (other registers keep polling)",
            );
          }
        }
      } else if (this.#regFailures.has(key) || this.#regCoolingUntil.has(key)) {
        this.#regFailures.delete(key);
        this.#regCoolingUntil.delete(key);
      }
    }
  }

  /** One request per contiguous block, falling back to per-register on failure. */
  async #readBlocks(
    device: ResolvedDevice,
    registers: readonly ResolvedRegister[],
  ): Promise<MetricReading[]> {
    const blocks = planReadBlocks(registers, this.opts.maxRegisterGap ?? 0);
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
      if (!value) {
        // Nothing came back after every retry. Counted here, on the terminal
        // path, so an absent slave is a number instead of silence — a block
        // failure alone is not counted because it always falls back to here.
        this.hooks.onReadFailure(slave);
      }
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
