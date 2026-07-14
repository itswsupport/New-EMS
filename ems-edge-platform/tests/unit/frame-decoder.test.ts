import { describe, it, expect } from "vitest";
import { FrameDecoder } from "@ems/modbus";

describe("FrameDecoder (stream framing by expected length)", () => {
  it("assembles a frame split across chunks", () => {
    const d = new FrameDecoder();
    d.push(Uint8Array.from([0x07, 0x03]));
    expect(d.takeFrame(9)).toBeNull(); // not enough yet
    d.push(Uint8Array.from([0x04, 0x43, 0x66, 0x80, 0x00, 0xAB, 0xCD]));
    const frame = d.takeFrame(9);
    expect(frame).not.toBeNull();
    expect(frame!.length).toBe(9);
  });

  it("keeps leftover bytes for the next transaction", () => {
    const d = new FrameDecoder();
    d.push(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0xFF, 0xEE]));
    d.takeFrame(9);
    expect(d.pending).toBe(2);
  });

  it("reset() clears buffered bytes for resync", () => {
    const d = new FrameDecoder();
    d.push(Uint8Array.from([1, 2, 3]));
    d.reset();
    expect(d.pending).toBe(0);
  });
});
