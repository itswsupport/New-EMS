import { describe, it, expect } from "vitest";
import { ModbusTcpCodec, createModbusCodec } from "@ems/modbus";
import { isErr, isOk, ModbusExceptionError } from "@ems/common";

/** Build an MBAP response echoing a transaction id, carrying register bytes. */
function mbapResponse(txn: number, slave: number, registerBytes: Uint8Array): Uint8Array {
  const dataLen = 2 + registerBytes.length; // fc + byteCount + data
  const frame = new Uint8Array(7 + dataLen);
  frame[0] = (txn >>> 8) & 0xff;
  frame[1] = txn & 0xff;
  frame[2] = 0; frame[3] = 0;            // protocol id
  frame[4] = ((1 + dataLen) >>> 8) & 0xff;
  frame[5] = (1 + dataLen) & 0xff;       // length = unit + fc + byteCount + data
  frame[6] = slave;
  frame[7] = 0x03;                        // FC03
  frame[8] = registerBytes.length;        // byteCount
  frame.set(registerBytes, 9);
  return frame;
}

describe("Modbus TCP (MBAP) codec", () => {
  it("builds a 12-byte FC03 request with an MBAP header and NO CRC", () => {
    const codec = new ModbusTcpCodec();
    const req = codec.buildReadHoldingRequest(7, 0, 2);
    expect(req).toHaveLength(12);
    expect(Array.from(req.slice(2, 12))).toEqual([
      0x00, 0x00, // protocol id
      0x00, 0x06, // length
      0x07, 0x03, 0x00, 0x00, 0x00, 0x02, // unit, fc, addr, qty
    ]);
  });

  it("expected response length = MBAP(7) + fc+byteCount(2) + 2N", () => {
    expect(new ModbusTcpCodec().expectedReadResponseLength(2)).toBe(13);
  });

  it("round-trips: request txn is echoed and parsed", () => {
    const codec = createModbusCodec("tcp");
    const req = codec.buildReadHoldingRequest(7, 0, 2);
    const txn = (req[0]! << 8) | req[1]!;
    const frame = mbapResponse(txn, 7, Uint8Array.from([0x43, 0x66, 0x80, 0x00]));
    const res = codec.parseReadResponse(frame, 7);
    expect(isOk(res) && res.value.data.length).toBe(4);
  });

  it("accepts a response whose transaction id differs (gateway reassigns it)", () => {
    // A Modbus RTU<->TCP gateway (e.g. SenseLive X5050) assigns its OWN MBAP
    // transaction ids on the reply — they never match ours. Since we serialize
    // requests, correlation is by ordering, so a differing txn must still parse.
    const codec = new ModbusTcpCodec();
    codec.buildReadHoldingRequest(7, 0, 2);           // our txn = 1
    const reply = mbapResponse(0x0bc9, 7, Uint8Array.from([0x43, 0x67, 0xb9, 0x7e]));
    const res = codec.parseReadResponse(reply, 7);
    expect(isOk(res) && res.value.data.length).toBe(4);
  });

  it("surfaces a Modbus exception frame", () => {
    const codec = new ModbusTcpCodec();
    const req = codec.buildReadHoldingRequest(7, 0, 2);
    const txn = (req[0]! << 8) | req[1]!;
    // FC 0x83 (0x03|0x80), exception code 0x02
    const frame = Uint8Array.from([(txn >> 8) & 0xff, txn & 0xff, 0, 0, 0, 3, 7, 0x83, 0x02]);
    const res = codec.parseReadResponse(frame, 7);
    expect(isErr(res) && res.error instanceof ModbusExceptionError).toBe(true);
  });
});
