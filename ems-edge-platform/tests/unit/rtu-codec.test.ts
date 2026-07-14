import { describe, it, expect } from "vitest";
import { appendCrc, buildReadHoldingRequest, expectedReadResponseLength, parseReadResponse } from "@ems/modbus";
import { isErr, isOk, CrcError, ModbusExceptionError } from "@ems/common";
import { buildFloatResponse } from "../helpers/modbus-frame.js";

describe("RTU codec", () => {
  it("builds a correct FC03 request", () => {
    const req = buildReadHoldingRequest(7, 0, 2);
    expect(Array.from(req.slice(0, 6))).toEqual([0x07, 0x03, 0x00, 0x00, 0x00, 0x02]);
    expect(req.length).toBe(8); // 6 + CRC
  });

  it("computes expected response length", () => {
    expect(expectedReadResponseLength(2)).toBe(9); // 5 + 2*2
  });

  it("parses a valid float response", () => {
    const frame = buildFloatResponse(7, 230.5);
    const res = parseReadResponse(frame, 7);
    expect(isOk(res) && res.value.data.length).toBe(4);
  });

  it("returns CrcError on corruption", () => {
    const frame = buildFloatResponse(7, 230.5);
    frame[4] = (frame[4] ?? 0) ^ 0xff;
    const res = parseReadResponse(frame, 7);
    expect(isErr(res) && res.error instanceof CrcError).toBe(true);
  });

  it("returns ModbusExceptionError on exception frame", () => {
    // slave=7, fc=0x83 (0x03|0x80), exc=0x02 + CRC
    const frame: Uint8Array = appendCrc(Uint8Array.from([0x07, 0x83, 0x02]));
    const res = parseReadResponse(frame, 7);
    expect(isErr(res) && res.error instanceof ModbusExceptionError).toBe(true);
  });
});
