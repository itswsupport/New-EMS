import type { Database } from "@ems/database";
import type { ReadinessProbe } from "@ems/api";

/**
 * SystemReadiness — concrete liveness/readiness for the API probes.
 *  • Liveness  = the process is running (Kubernetes restarts if this fails).
 *  • Readiness = the database answers a trivial query AND the TCP listener is
 *    bound (load balancer/orchestrator only routes when this is true).
 */
export class SystemReadiness implements ReadinessProbe {
  constructor(
    private readonly db: Database,
    private readonly isListening: () => boolean,
  ) {}

  isAlive(): boolean {
    return true;
  }

  async checkReady(): Promise<{ ready: boolean; details: Record<string, boolean> }> {
    const details: Record<string, boolean> = { listener: this.isListening() };
    try {
      await this.db.$queryRaw`SELECT 1`;
      details["database"] = true;
    } catch {
      details["database"] = false;
    }
    const ready = Object.values(details).every(Boolean);
    return { ready, details };
  }
}
