import { describe, it, expect } from "vitest";
import { mapReadingsToRecord, validateTelemetry } from "@ems/telemetry";
import { isOk } from "@ems/common";

const identity = { deviceId: "meter07", tenantId: "rucha", plantId: "plant01" };
const ts = new Date("2026-07-14T00:00:00.000Z");

describe("telemetry mapper — quality derivation", () => {
  it("marks GOOD when all readings decode", () => {
    const rec = mapReadingsToRecord(
      identity,
      [
        { metric: "voltage", value: 230 },
        { metric: "current", value: 5 },
      ],
      ts,
    );
    expect(rec.quality).toBe("GOOD");
    expect(rec.voltage).toBe(230);
  });

  it("marks UNCERTAIN on partial decode", () => {
    const rec = mapReadingsToRecord(
      identity,
      [
        { metric: "voltage", value: 230 },
        { metric: "current", value: null },
      ],
      ts,
    );
    expect(rec.quality).toBe("UNCERTAIN");
  });

  it("marks BAD when nothing decodes", () => {
    const rec = mapReadingsToRecord(identity, [{ metric: "voltage", value: null }], ts);
    expect(rec.quality).toBe("BAD");
  });

  it("ignores unknown metric keys and derives quality over known ones only", () => {
    const rec = mapReadingsToRecord(
      identity,
      [
        { metric: "voltage", value: 230 },
        { metric: "made_up", value: 1 }, // unknown → must not affect quality
      ],
      ts,
    );
    expect(rec.voltage).toBe(230);
    expect(rec.quality).toBe("GOOD");
  });
});

describe("telemetry validation", () => {
  it("downgrades implausible readings to BAD without dropping them", () => {
    const rec = mapReadingsToRecord(identity, [{ metric: "voltage", value: 1e38 }], ts);
    const validated = validateTelemetry(rec);
    expect(isOk(validated) && validated.value.quality).toBe("BAD");
    expect(isOk(validated) && validated.value.voltage).toBe(1e38); // still present
  });
});
