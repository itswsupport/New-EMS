import { randomUUID } from "node:crypto";
import type { ConnectionId } from "./types.js";
import { asConnectionId } from "./types.js";

/**
 * Monotonic-ish, sortable connection identifier: <base36 time>-<rand>.
 * Avoids an external ULID dependency while remaining time-ordered for log
 * correlation across the lifetime of a gateway socket.
 */
export function newConnectionId(): ConnectionId {
  const ts = Date.now().toString(36);
  const rand = randomUUID().replace(/-/g, "").slice(0, 10);
  return asConnectionId(`conn_${ts}_${rand}`);
}
