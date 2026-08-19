import { describe, it, expect } from "vitest";
import type { ResolvedRegister } from "@ems/config";
import { planReadBlocks } from "../../apps/gateway-listener/src/poller.js";

const reg = (metric: string, address: number, quantity = 2): ResolvedRegister => ({
  metric,
  address,
  quantity,
  datatype: "float32",
  byteOrder: "ABCD",
  scale: 1,
});

describe("planReadBlocks", () => {
  it("returns nothing for no registers", () => {
    expect(planReadBlocks([])).toEqual([]);
  });

  it("merges strictly adjacent registers into one request", () => {
    const blocks = planReadBlocks([reg("a", 0), reg("b", 2), reg("c", 4)]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.address).toBe(0);
    expect(blocks[0]!.quantity).toBe(6);
    expect(blocks[0]!.registers.map((r) => r.metric)).toEqual(["a", "b", "c"]);
  });

  it("splits on a gap, because reading an unmapped address can corrupt the response", () => {
    // Registers at 0-2 and 6-8: address 4 is not mapped, so it must not be read.
    const blocks = planReadBlocks([reg("a", 0), reg("b", 6)]);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => [b.address, b.quantity])).toEqual([
      [0, 2],
      [6, 2],
    ]);
  });

  it("bridges a gap only when explicitly allowed", () => {
    const regs = [reg("a", 0), reg("b", 4)]; // two-register hole at 2
    expect(planReadBlocks(regs, 0)).toHaveLength(2);
    expect(planReadBlocks(regs, 2)).toHaveLength(1);
    expect(planReadBlocks(regs, 2)[0]!.quantity).toBe(6);
  });

  it("sorts by address, so config order does not change the plan", () => {
    const blocks = planReadBlocks([reg("c", 4), reg("a", 0), reg("b", 2)]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.registers.map((r) => r.metric)).toEqual(["a", "b", "c"]);
  });

  it("never exceeds the 125-register Modbus limit", () => {
    const many = Array.from({ length: 100 }, (_, i) => reg(`m${i}`, i * 2));
    const blocks = planReadBlocks(many);
    expect(blocks.length).toBeGreaterThan(1);
    for (const b of blocks) expect(b.quantity).toBeLessThanOrEqual(125);
    // Every register still gets read exactly once.
    expect(blocks.flatMap((b) => b.registers)).toHaveLength(100);
  });

  it("handles two metrics sharing one address", () => {
    const blocks = planReadBlocks([reg("a", 10), reg("alias", 10)]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.quantity).toBe(2);
    expect(blocks[0]!.registers).toHaveLength(2);
  });

  it("collapses the real LM1360 map into far fewer requests", () => {
    // The addresses actually configured in config/devices.yaml.
    const lm1360 = [
      0, 2, 4, 6, 8, 10, 12, 14, 16, 30, 32, 34, 42, 46, 52, 56, 58, 62, 70, 72, 76,
      102, 218, 220,
    ].map((a, i) => reg(`m${i}`, a));

    const blocks = planReadBlocks(lm1360);
    expect(blocks.flatMap((b) => b.registers)).toHaveLength(lm1360.length);
    // 24 individual requests today; contiguous runs should cut that sharply.
    expect(blocks.length).toBeLessThanOrEqual(12);

    // No block may span an address that is not configured.
    const configured = new Set(lm1360.map((r) => r.address));
    for (const b of blocks) {
      for (let a = b.address; a < b.address + b.quantity; a += 2) {
        expect(configured.has(a)).toBe(true);
      }
    }
  });
});
