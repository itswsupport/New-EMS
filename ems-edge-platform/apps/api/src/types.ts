import type { ConnectionSnapshot, StatisticsSnapshot } from "@ems/observability";

/**
 * ReadinessProbe — the API asks the rest of the system whether it can serve
 * traffic (DB reachable, listener bound). Injected so the API package never
 * imports the gateway/database packages directly (keeps the dependency graph acyclic).
 */
export interface ReadinessProbe {
  /** Liveness: process is up and the event loop is responsive. Always cheap. */
  isAlive(): boolean;
  /** Readiness: dependencies (DB, listener) are usable. May do a light check. */
  checkReady(): Promise<{ ready: boolean; details: Record<string, boolean> }>;
}

export interface StatsProvider {
  listConnections(): ConnectionSnapshot[];
  statistics(): StatisticsSnapshot;
}

/** Safe, non-secret view of effective config for GET /config. */
export type SafeConfigView = Record<string, string | number | boolean>;

export interface VersionInfo {
  readonly service: string;
  readonly version: string;
  readonly nodeVersion: string;
  readonly commit: string;
}
