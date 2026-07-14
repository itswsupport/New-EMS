import {
  CrcError,
  ModbusExceptionError,
  DomainError,
  type Result,
  ok,
  err,
} from "@ems/common";
import { appendCrc, verifyCrc } from "./crc16.js";

/**
 * Modbus RTU framing (over TCP, because the X5050 forwards RTU bytes transparently).
 * We act as the MASTER: build read requests, and parse the meter's responses.
 *
 * RTU request  (FC03): [slave][0x03][addrHi][addrLo][qtyHi][qtyLo][crcLo][crcHi]
 * RTU response (FC03): [slave][0x03][byteCount][data...][crcLo][crcHi]
 * RTU exception:       [slave][0x83][excCode][crcLo][crcHi]   (fc | 0x80)
 */
export const FN_READ_HOLDING = 0x03;

/** Build a "read holding registers" request ADU with CRC appended. */
export function buildReadHoldingRequest(
  slave: number,
  address: number,
  quantity: number,
): Uint8Array {
  const adu = new Uint8Array(6);
  adu[0] = slave & 0xff;
  adu[1] = FN_READ_HOLDING;
  adu[2] = (address >>> 8) & 0xff;
  adu[3] = address & 0xff;
  adu[4] = (quantity >>> 8) & 0xff;
  adu[5] = quantity & 0xff;
  return appendCrc(adu);
}

/** Expected total response length in bytes for a successful FC03 read. */
export function expectedReadResponseLength(quantity: number): number {
  // slave(1) + fc(1) + byteCount(1) + data(2*qty) + crc(2)
  return 5 + 2 * quantity;
}

export interface ParsedResponse {
  readonly slave: number;
  readonly data: Uint8Array; // register payload only (byteCount bytes)
}

/**
 * Parse a complete RTU response frame. Order of checks matters: CRC first (a
 * corrupt frame's function/exception bytes are untrustworthy), then exception,
 * then structural validation.
 */
export function parseReadResponse(
  frame: Uint8Array,
  expectedSlave: number,
): Result<ParsedResponse, DomainError> {
  if (frame.length < 5) {
    return err(new DomainError("FRAME_INCOMPLETE", "response shorter than minimum", {
      length: frame.length,
    }));
  }
  if (!verifyCrc(frame)) {
    return err(new CrcError({ slave: expectedSlave, length: frame.length }));
  }

  const slave = frame[0]!;
  const fn = frame[1]!;

  if ((fn & 0x80) !== 0) {
    const exceptionCode = frame[2] ?? 0;
    return err(new ModbusExceptionError(exceptionCode, { slave }));
  }
  if (fn !== FN_READ_HOLDING) {
    return err(new DomainError("MODBUS_EXCEPTION", "unexpected function code", { fn, slave }));
  }

  const byteCount = frame[2]!;
  const dataStart = 3;
  const dataEnd = dataStart + byteCount;
  if (dataEnd + 2 !== frame.length) {
    return err(new DomainError("REGISTER_DECODE_ERROR", "byteCount/frame length mismatch", {
      byteCount,
      length: frame.length,
    }));
  }

  return ok({ slave, data: frame.subarray(dataStart, dataEnd) });
}
