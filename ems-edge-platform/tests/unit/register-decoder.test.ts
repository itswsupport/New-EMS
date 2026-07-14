import { describe, it, expect } from "vitest";
import { decodeRegisters } from "@ems/modbus";
import { isOk, isErr } from "@ems/common";

// 230.5 as IEEE-754 float32 big-endian (ABCD) = 43 66 80 00
const ABCD = Uint8Array.from([0x43, 0x66, 0x80, 0x00]);

describe("register decoder (float32 byte ordering)", () => {
  it("decodes ABCD big-endian correctly", () => {
    const r = decodeRegisters(ABCD, "float32", "ABCD");
    expect(isOk(r) && Math.abs(r.value - 230.5) < 1e-3).toBe(true);
  });

  it("decodes CDAB (word swap)", () => {
    const cdab = Uint8Array.from([0x80, 0x00, 0x43, 0x66]);
    const r = decodeRegisters(cdab, "float32", "CDAB");
    expect(isOk(r) && Math.abs(r.value - 230.5) < 1e-3).toBe(true);
  });

  it("decodes DCBA (full reverse)", () => {
    const dcba = Uint8Array.from([0x00, 0x80, 0x66, 0x43]);
    const r = decodeRegisters(dcba, "float32", "DCBA");
    expect(isOk(r) && Math.abs(r.value - 230.5) < 1e-3).toBe(true);
  });

  it("applies scale to integer types", () => {
    const raw = Uint8Array.from([0x00, 0x64]); // 100
    const r = decodeRegisters(raw, "uint16", "ABCD", 0.1);
    expect(isOk(r) && Math.abs(r.value - 10) < 1e-9).toBe(true);
  });

  it("errors on wrong byte length", () => {
    const r = decodeRegisters(Uint8Array.from([0x00]), "float32", "ABCD");
    expect(isErr(r)).toBe(true);
  });
});
