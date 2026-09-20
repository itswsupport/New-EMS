import { describe, it, expect } from "vitest";
import { frameLength } from "@ems/modbus";

describe("frameLength — exception-aware framing", () => {
  it("RTU: waits for the full expected length on a normal response", () => {
    const expected = 5 + 2 * 2; // qty 2 → 9 bytes
    expect(frameLength("rtu", new Uint8Array([7, 0x03, 4, 0, 0, 0, 0]), expected)).toBeNull();
    expect(frameLength("rtu", new Uint8Array([7, 0x03, 4, 0, 0, 0, 0, 1, 2]), expected)).toBe(expected);
  });

  it("RTU: completes early at 5 bytes on an exception (fc | 0x80)", () => {
    const expected = 5 + 2 * 25; // a large normal expectation
    expect(frameLength("rtu", new Uint8Array([7, 0x83]), expected)).toBeNull(); // fc seen, <5 bytes
    expect(frameLength("rtu", new Uint8Array([7, 0x83, 2, 0xaa, 0xbb]), expected)).toBe(5);
  });

  it("TCP: waits for the full expected length on a normal response", () => {
    const expected = 9 + 2 * 2; // 13 bytes
    expect(frameLength("tcp", new Uint8Array(9), expected)).toBeNull(); // fc @7 = 0, normal, <13
    expect(frameLength("tcp", new Uint8Array(13), expected)).toBe(expected);
  });

  it("TCP: completes early at 9 bytes on an exception (fc | 0x80 @ offset 7)", () => {
    const expected = 9 + 2 * 25;
    const buf = new Uint8Array(9);
    buf[7] = 0x83;
    buf[8] = 2;
    expect(frameLength("tcp", buf.subarray(0, 8), expected)).toBeNull(); // exception, but <9
    expect(frameLength("tcp", buf, expected)).toBe(9);
  });

  it("returns null before the function-code byte is even visible", () => {
    expect(frameLength("rtu", new Uint8Array([7]), 9)).toBeNull();
    expect(frameLength("tcp", new Uint8Array(7), 13)).toBeNull();
  });
});
