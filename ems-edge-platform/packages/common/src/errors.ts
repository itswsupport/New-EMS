/**
 * Domain error taxonomy. Each error is a discrete, loggable failure mode of the
 * pipeline. `code` is a stable machine key (metrics/alerting); `context` carries
 * structured detail. We never throw bare strings.
 */
export type ErrorCode =
  | "FRAME_INCOMPLETE"
  | "CRC_ERROR"
  | "MODBUS_EXCEPTION"
  | "REGISTER_DECODE_ERROR"
  | "VALIDATION_ERROR"
  | "CONFIG_ERROR"
  | "DB_WRITE_ERROR"
  | "TIMEOUT"
  | "CONNECTION_ERROR";

export type ErrorContext = Record<string, string | number | boolean | null>;

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly context: ErrorContext;

  constructor(code: ErrorCode, message: string, context: ErrorContext = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.context = context;
  }
}

export class CrcError extends DomainError {
  constructor(context: ErrorContext = {}) {
    super("CRC_ERROR", "Modbus RTU CRC mismatch", context);
    this.name = "CrcError";
  }
}

export class ModbusExceptionError extends DomainError {
  constructor(exceptionCode: number, context: ErrorContext = {}) {
    super("MODBUS_EXCEPTION", `Modbus exception 0x${exceptionCode.toString(16)}`, {
      ...context,
      exceptionCode,
    });
    this.name = "ModbusExceptionError";
  }
}

export class RegisterDecodeError extends DomainError {
  constructor(message: string, context: ErrorContext = {}) {
    super("REGISTER_DECODE_ERROR", message, context);
    this.name = "RegisterDecodeError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, context: ErrorContext = {}) {
    super("VALIDATION_ERROR", message, context);
    this.name = "ValidationError";
  }
}

export class TimeoutError extends DomainError {
  constructor(message: string, context: ErrorContext = {}) {
    super("TIMEOUT", message, context);
    this.name = "TimeoutError";
  }
}
