import { describe, it, expect } from "vitest";
import { crc16, appendCrc, verifyCrc } from "@ems/modbus";

describe("CRC-16/MODBUS", () => {
  it("matches the canonical vector for '123456789'", () => {
    // Well-known CRC-16/MODBUS check value = 0x4B37.
    const data = new TextEncoder().encode("123456789");
    expect(crc16(data)).toBe(0x4b37);
  });

  it("computes a known FC03 request CRC (slave 7, addr 0, qty 2)", () => {
    const req = appendCrc(Uint8Array.from([0x07, 0x03, 0x00, 0x00, 0x00, 0x02]));
    // Verify round-trips against the same algorithm.
    expect(verifyCrc(req)).toBe(true);
  });

  it("verifyCrc rejects a corrupted frame", () => {
    const frame = appendCrc(Uint8Array.from([0x07, 0x03, 0x02, 0x43, 0x6f]));
    const corrupted = Uint8Array.from(frame);
    corrupted[3] = (corrupted[3] ?? 0) ^ 0xff; // flip a payload bit
    expect(verifyCrc(corrupted)).toBe(false);
  });

  it("appendCrc writes low byte first (RTU order)", () => {
    const adu = Uint8Array.from([0x07, 0x03, 0x00, 0x00, 0x00, 0x02]);
    const withCrc = appendCrc(adu);
    const crc = crc16(adu);
    expect(withCrc[withCrc.length - 2]).toBe(crc & 0xff);
    expect(withCrc[withCrc.length - 1]).toBe((crc >>> 8) & 0xff);
  });
});
