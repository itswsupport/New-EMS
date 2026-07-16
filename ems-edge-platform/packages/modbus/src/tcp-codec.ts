import { DomainError, ModbusExceptionError, type Result, ok, err } from "@ems/common";
import type { ModbusCodec, ParsedResponse } from "./codec.js";

/**
 * Modbus TCP (MBAP) codec — for a gateway in "Modbus TCP to RTU" conversion mode
 * (the SenseLive X5050's default). The gateway owns the serial-side RTU frame and
 * its CRC, so there is NO CRC here.
 *
 *  MBAP header (7 bytes):
 *    [0..1] transaction id   — echoed back by the server; we verify it
 *    [2..3] protocol id      — always 0x0000 for Modbus
 *    [4..5] length           — byte count of everything AFTER this field
 *    [6]    unit id          — the RTU slave id
 *
 *  Request  (12 bytes): MBAP + FC(1) + startAddr(2) + quantity(2)
 *  Response (9 + 2N)  : MBAP + FC(1) + byteCount(1) + data(2N)
 */
const FN_READ_HOLDING = 0x03; // local: rtu-codec owns the exported constant
const MBAP_LEN = 7;

export class ModbusTcpCodec implements ModbusCodec {
  readonly framing = "tcp" as const;
  /** Per-connection transaction counter; wraps at 16 bits. */
  #txn = 0;
  #lastTxn = 0;

  buildReadHoldingRequest(slave: number, address: number, quantity: number): Uint8Array {
    this.#txn = (this.#txn + 1) & 0xffff;
    this.#lastTxn = this.#txn;

    const adu = new Uint8Array(12);
    adu[0] = (this.#txn >>> 8) & 0xff;
    adu[1] = this.#txn & 0xff;
    adu[2] = 0x00; // protocol id hi
    adu[3] = 0x00; // protocol id lo
    adu[4] = 0x00; // length hi
    adu[5] = 0x06; // length lo: unit(1) + fc(1) + addr(2) + qty(2)
    adu[6] = slave & 0xff;
    adu[7] = FN_READ_HOLDING;
    adu[8] = (address >>> 8) & 0xff;
    adu[9] = address & 0xff;
    adu[10] = (quantity >>> 8) & 0xff;
    adu[11] = quantity & 0xff;
    return adu;
  }

  expectedReadResponseLength(quantity: number): number {
    // MBAP(7) + fc(1) + byteCount(1) + data(2N)
    return MBAP_LEN + 2 + 2 * quantity;
  }

  parseReadResponse(frame: Uint8Array, expectedSlave: number): Result<ParsedResponse, DomainError> {
    if (frame.length < MBAP_LEN + 2) {
      return err(
        new DomainError("FRAME_INCOMPLETE", "MBAP response shorter than minimum", {
          length: frame.length,
        }),
      );
    }

    const protocolId = (frame[2]! << 8) | frame[3]!;
    if (protocolId !== 0) {
      return err(
        new DomainError("MODBUS_EXCEPTION", "not a Modbus MBAP frame", { protocolId }),
      );
    }

    const txn = (frame[0]! << 8) | frame[1]!;
    if (txn !== this.#lastTxn) {
      // A stale/out-of-order reply. Transactions are serialized, so this means
      // the bus desynced — surface it rather than mapping the wrong register.
      return err(
        new DomainError("MODBUS_EXCEPTION", "transaction id mismatch", {
          expected: this.#lastTxn,
          got: txn,
        }),
      );
    }

    const slave = frame[6]!;
    const fn = frame[7]!;

    if ((fn & 0x80) !== 0) {
      return err(new ModbusExceptionError(frame[8] ?? 0, { slave }));
    }
    if (fn !== FN_READ_HOLDING) {
      return err(new DomainError("MODBUS_EXCEPTION", "unexpected function code", { fn, slave }));
    }
    if (slave !== expectedSlave) {
      return err(
        new DomainError("MODBUS_EXCEPTION", "unit id mismatch", { expected: expectedSlave, got: slave }),
      );
    }

    const byteCount = frame[8]!;
    const dataStart = MBAP_LEN + 2;
    const dataEnd = dataStart + byteCount;
    if (dataEnd !== frame.length) {
      return err(
        new DomainError("REGISTER_DECODE_ERROR", "byteCount/frame length mismatch", {
          byteCount,
          length: frame.length,
        }),
      );
    }

    return ok({ slave, data: frame.subarray(dataStart, dataEnd) });
  }
}
