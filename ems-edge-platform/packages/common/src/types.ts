/**
 * Cross-cutting primitive types shared by every layer. Branded string types make
 * identity mix-ups (passing a plantId where a tenantId is expected) a compile
 * error rather than a silent data-corruption bug.
 */
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type PlantId = Brand<string, "PlantId">;
export type DeviceId = Brand<string, "DeviceId">;
export type ConnectionId = Brand<string, "ConnectionId">;

export const asTenantId = (v: string): TenantId => v as TenantId;
export const asPlantId = (v: string): PlantId => v as PlantId;
export const asDeviceId = (v: string): DeviceId => v as DeviceId;
export const asConnectionId = (v: string): ConnectionId => v as ConnectionId;

/** Measurement trust level attached to every telemetry record. */
export type Quality = "GOOD" | "UNCERTAIN" | "BAD";

/** Float32 byte/word ordering for Modbus multi-register decoding. */
export type ByteOrder = "ABCD" | "BADC" | "CDAB" | "DCBA";

/** Identity context threaded through logs and telemetry. */
export interface IdentityContext {
  readonly tenantId: TenantId;
  readonly plantId: PlantId;
  readonly deviceId: DeviceId;
}
