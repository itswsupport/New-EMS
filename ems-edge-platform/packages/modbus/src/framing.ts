import type { ModbusFraming } from "./codec.js";

/**
 * Where the function-code byte sits and how long a Modbus EXCEPTION response is,
 * per framing. An exception frame (fc | 0x80) is ALWAYS shorter than the data
 * response we frame by expectation, so without this a legitimate exception
 * (e.g. illegal data address for an unsupported register) never completes the
 * frame and degrades into a full read timeout — wasting maxRetries×timeout and
 * leaving the exception path dead.
 *
 *  RTU exception: [slave][fc|0x80][exc][crcLo][crcHi]  = 5 bytes, fc @ offset 1
 *  TCP exception: [MBAP(7)][fc|0x80][exc]              = 9 bytes, fc @ offset 7
 */
const SPEC: Record<ModbusFraming, { fcOffset: number; exceptionLength: number }> = {
  rtu: { fcOffset: 1, exceptionLength: 5 },
  tcp: { fcOffset: 7, exceptionLength: 9 },
};

/**
 * How many buffered bytes make ONE complete frame, or null if undecidable yet.
 * Returns the short exception length once the function-code byte is visible and
 * has its exception bit (0x80) set; otherwise the normal expected length. Pure.
 */
export function frameLength(
  framing: ModbusFraming,
  buffer: Uint8Array,
  expectedLength: number,
): number | null {
  const { fcOffset, exceptionLength } = SPEC[framing];
  if (buffer.length > fcOffset && (buffer[fcOffset]! & 0x80) !== 0) {
    return buffer.length >= exceptionLength ? exceptionLength : null;
  }
  return buffer.length >= expectedLength ? expectedLength : null;
}
