import type { ModbusCodec, ModbusFraming } from "./codec.js";
import { ModbusRtuCodec } from "./rtu-codec.js";
import { ModbusTcpCodec } from "./tcp-codec.js";

export * from "./crc16.js";
export * from "./register-decoder.js";
export * from "./codec.js";
export * from "./rtu-codec.js";
export * from "./tcp-codec.js";
export * from "./frame-decoder.js";

/**
 * Factory (Strategy selection). One codec instance PER CONNECTION — the TCP
 * codec carries a transaction counter that must not be shared across sockets.
 */
export function createModbusCodec(framing: ModbusFraming): ModbusCodec {
  return framing === "tcp" ? new ModbusTcpCodec() : new ModbusRtuCodec();
}
