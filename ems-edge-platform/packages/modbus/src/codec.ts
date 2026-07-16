import type { DomainError, Result } from "@ems/common";

/**
 * ModbusCodec — the framing STRATEGY.
 *
 * Serial-to-Ethernet gateways sit in one of two modes, and they are NOT
 * interchangeable on the wire:
 *
 *  • "tcp"  — Modbus TCP / MBAP. The gateway CONVERTS protocols (SenseLive calls
 *             this "Modbus TCP to RTU"). We must send an MBAP header and NO CRC;
 *             the gateway builds the RTU frame (and its CRC) on the serial side.
 *             Request = 12 bytes, response = 9 + 2N.
 *
 *  • "rtu"  — transparent passthrough. The gateway forwards raw bytes, so WE own
 *             RTU framing and the CRC16. Request = 8 bytes, response = 5 + 2N.
 *
 * Sending RTU to a gateway in conversion mode fails SILENTLY: it TCP-ACKs the
 * bytes, fails to parse an MBAP header, drops the frame, and never answers. You
 * see a healthy socket and zero data. Hence this is a first-class config knob
 * (MODBUS_FRAMING), not a hardcoded assumption.
 */
export type ModbusFraming = "tcp" | "rtu";

export interface ParsedResponse {
  readonly slave: number;
  /** Register payload bytes only (big-endian, byteCount long). */
  readonly data: Uint8Array;
}

export interface ModbusCodec {
  readonly framing: ModbusFraming;

  /** Build a "read holding registers" (FC03) request. */
  buildReadHoldingRequest(slave: number, address: number, quantity: number): Uint8Array;

  /** Exact byte length of a successful FC03 response — we frame by expectation. */
  expectedReadResponseLength(quantity: number): number;

  /** Validate + parse a complete response frame. */
  parseReadResponse(frame: Uint8Array, expectedSlave: number): Result<ParsedResponse, DomainError>;
}

/** Factory — one codec per connection (the TCP codec holds a transaction counter). */
export type ModbusCodecFactory = () => ModbusCodec;
