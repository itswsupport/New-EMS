import { appendCrc } from "@ems/modbus";

/** Encode a float32 into 2 Modbus registers using ABCD (big-endian) order. */
export function float32ToRegisters(value: number): Uint8Array {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(value, 0);
  return Uint8Array.from(buf); // [A,B,C,D]
}

/** Build a valid FC03 response ADU (with CRC) carrying the given register bytes. */
export function buildReadResponse(slave: number, registerBytes: Uint8Array): Uint8Array {
  const adu = new Uint8Array(3 + registerBytes.length);
  adu[0] = slave;
  adu[1] = 0x03;
  adu[2] = registerBytes.length;
  adu.set(registerBytes, 3);
  return appendCrc(adu);
}

/** Build a FC03 float32 response for a single value. */
export function buildFloatResponse(slave: number, value: number): Uint8Array {
  return buildReadResponse(slave, float32ToRegisters(value));
}
