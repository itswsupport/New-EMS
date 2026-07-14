/**
 * CRC-16/MODBUS (poly 0xA001, init 0xFFFF). Used to validate every RTU frame.
 *
 * A 256-entry lookup table is precomputed once so CRC verification is O(n) with
 * no inner bit loop — important when validating millions of frames per day.
 */
const TABLE: Uint16Array = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
    t[i] = crc;
  }
  return t;
})();

/** Compute the CRC-16/MODBUS over the given bytes (optionally a sub-range). */
export function crc16(buf: Uint8Array, start = 0, end = buf.length): number {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    crc = (crc >>> 8) ^ TABLE[(crc ^ buf[i]!) & 0xff]!;
  }
  return crc & 0xffff;
}

/** Append the CRC to an ADU (RTU order: low byte first, then high byte). */
export function appendCrc(adu: Uint8Array): Uint8Array {
  const crc = crc16(adu);
  const out = new Uint8Array(adu.length + 2);
  out.set(adu, 0);
  out[adu.length] = crc & 0xff;
  out[adu.length + 1] = (crc >>> 8) & 0xff;
  return out;
}

/** Verify the trailing 2-byte CRC of a full RTU frame. */
export function verifyCrc(frame: Uint8Array): boolean {
  if (frame.length < 4) return false;
  const bodyEnd = frame.length - 2;
  const expected = crc16(frame, 0, bodyEnd);
  const actual = frame[bodyEnd]! | (frame[bodyEnd + 1]! << 8);
  return expected === actual;
}
