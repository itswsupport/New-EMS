import { RegisterDecodeError, type ByteOrder, type Result, ok, err } from "@ems/common";

/**
 * Decodes raw Modbus register bytes into JS numbers. Isolated from framing and
 * transport so it is trivially unit-testable with fixed byte vectors.
 *
 * Modbus registers are 16-bit big-endian. A float32/int32 spans two registers;
 * the four resulting bytes are labelled A(reg1 hi) B(reg1 lo) C(reg2 hi)
 * D(reg2 lo). Meters disagree on word/byte order, so we reorder per ByteOrder
 * before interpreting. This is the single knob that fixes "voltage reads garbage".
 */
const ORDER_INDEX: Record<ByteOrder, readonly [number, number, number, number]> = {
  ABCD: [0, 1, 2, 3],
  BADC: [1, 0, 3, 2],
  CDAB: [2, 3, 0, 1],
  DCBA: [3, 2, 1, 0],
};

function reorder4(raw: Uint8Array, order: ByteOrder): Buffer {
  const idx = ORDER_INDEX[order];
  return Buffer.from([raw[idx[0]]!, raw[idx[1]]!, raw[idx[2]]!, raw[idx[3]]!]);
}

export type DataType = "float32" | "int16" | "uint16" | "int32" | "uint32";

/**
 * Decode `data` (the register payload bytes, big-endian) into a number.
 * `scale` is applied after decoding (e.g. for milli-unit integer meters).
 */
export function decodeRegisters(
  data: Uint8Array,
  datatype: DataType,
  byteOrder: ByteOrder,
  scale = 1,
): Result<number, RegisterDecodeError> {
  try {
    const value = decodeRaw(data, datatype, byteOrder);
    if (!Number.isFinite(value)) {
      return err(new RegisterDecodeError("decoded non-finite value", { datatype }));
    }
    return ok(value * scale);
  } catch (cause) {
    return err(
      new RegisterDecodeError((cause as Error).message, { datatype, byteOrder }),
    );
  }
}

function decodeRaw(data: Uint8Array, datatype: DataType, byteOrder: ByteOrder): number {
  switch (datatype) {
    case "int16": {
      assertLen(data, 2, datatype);
      return Buffer.from(data).readInt16BE(0);
    }
    case "uint16": {
      assertLen(data, 2, datatype);
      return Buffer.from(data).readUInt16BE(0);
    }
    case "float32": {
      assertLen(data, 4, datatype);
      return reorder4(data, byteOrder).readFloatBE(0);
    }
    case "int32": {
      assertLen(data, 4, datatype);
      return reorder4(data, byteOrder).readInt32BE(0);
    }
    case "uint32": {
      assertLen(data, 4, datatype);
      return reorder4(data, byteOrder).readUInt32BE(0);
    }
  }
}

function assertLen(data: Uint8Array, len: number, datatype: DataType): void {
  if (data.length !== len) {
    throw new Error(`${datatype} requires ${len} bytes, got ${data.length}`);
  }
}
