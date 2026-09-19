import type { AlarmSnapshot } from "./queries";

/**
 * Alarm evaluation — pure, live-evaluated against a recent per-meter snapshot.
 *
 * There is no alarm-state table yet, so this reflects what is wrong RIGHT NOW,
 * not a history. Thresholds are sensible standard defaults; they should move to
 * per-plant config later (the plant table) so each connection can tune them.
 */

export type Severity = "crit" | "warn";

export type Alarm = {
  id: string;
  severity: Severity;
  deviceId: string;
  kind: string;
  message: string;
  detail?: string;
};

export const ALARM_LIMITS = {
  offlineSeconds: 60, // no data for longer than this → offline
  pfMin: 0.9, // load-weighted PF below this → low power factor
  voltageMin: 207, // 230 V −10%
  voltageMax: 253, // 230 V +10%
  freqMin: 49.5,
  freqMax: 50.5,
  voltageThdMax: 8, // % voltage distortion
  // Current THD is deliberately NOT alarmed: %-THD runs naturally high at part
  // load and the real limit (IEEE 519 TDD) is load-dependent, so it would fire
  // permanently and mean little. It stays a diagnostic on the Power Quality page.
} as const;

const n1 = (n: number | null): string => (n === null ? "—" : (Math.round(n * 10) / 10).toString());
const n3 = (n: number | null): string => (n === null ? "—" : n.toFixed(3));

function formatAge(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function istTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Evaluate all rules over the snapshot set. Ordered crit-first, then by meter. */
export function evaluateAlarms(snaps: AlarmSnapshot[], limits = ALARM_LIMITS): Alarm[] {
  const out: Alarm[] = [];
  for (const s of snaps) {
    // Liveness first — if offline / dead, the other values are stale or absent.
    if (s.ageSeconds === null) {
      out.push({
        id: `${s.deviceId}:offline`,
        severity: "crit",
        deviceId: s.deviceId,
        kind: "offline",
        message: "Offline — has never reported",
      });
      continue;
    }
    if (s.ageSeconds > limits.offlineSeconds) {
      out.push({
        id: `${s.deviceId}:offline`,
        severity: "crit",
        deviceId: s.deviceId,
        kind: "offline",
        message: `Offline — no data for ${formatAge(s.ageSeconds)}`,
        detail: s.lastSeen ? `last seen ${istTime(s.lastSeen)} IST` : undefined,
      });
      continue;
    }
    if (s.recentSamples > 0 && s.goodSamples === 0) {
      out.push({
        id: `${s.deviceId}:no-data`,
        severity: "crit",
        deviceId: s.deviceId,
        kind: "no-data",
        message: "Connected but returning no valid data",
      });
      continue;
    }

    if (s.lwPf !== null && s.lwPf < limits.pfMin) {
      out.push({
        id: `${s.deviceId}:low-pf`,
        severity: "warn",
        deviceId: s.deviceId,
        kind: "low-pf",
        message: `Power factor ${n3(s.lwPf)} below ${limits.pfMin}`,
      });
    }
    if (s.vMax !== null && s.vMax > limits.voltageMax) {
      out.push({
        id: `${s.deviceId}:over-voltage`,
        severity: "warn",
        deviceId: s.deviceId,
        kind: "over-voltage",
        message: `Over-voltage ${n1(s.vMax)} V (limit ${limits.voltageMax})`,
      });
    }
    if (s.vMin !== null && s.vMin < limits.voltageMin) {
      out.push({
        id: `${s.deviceId}:under-voltage`,
        severity: "warn",
        deviceId: s.deviceId,
        kind: "under-voltage",
        message: `Under-voltage ${n1(s.vMin)} V (limit ${limits.voltageMin})`,
      });
    }
    if (s.freq !== null && (s.freq < limits.freqMin || s.freq > limits.freqMax)) {
      out.push({
        id: `${s.deviceId}:frequency`,
        severity: "warn",
        deviceId: s.deviceId,
        kind: "frequency",
        message: `Frequency ${n1(s.freq)} Hz outside ${limits.freqMin}–${limits.freqMax}`,
      });
    }
    if (s.vThdMax !== null && s.vThdMax > limits.voltageThdMax) {
      out.push({
        id: `${s.deviceId}:voltage-thd`,
        severity: "warn",
        deviceId: s.deviceId,
        kind: "voltage-thd",
        message: `Voltage THD ${n1(s.vThdMax)}% above ${limits.voltageThdMax}%`,
      });
    }
  }
  const rank = (a: Alarm) => (a.severity === "crit" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.deviceId.localeCompare(b.deviceId));
}

export type AlarmSummary = { crit: number; warn: number; total: number; worst: Severity | null };

export function alarmSummary(alarms: Alarm[]): AlarmSummary {
  const crit = alarms.filter((a) => a.severity === "crit").length;
  const warn = alarms.length - crit;
  return { crit, warn, total: alarms.length, worst: crit ? "crit" : warn ? "warn" : null };
}
