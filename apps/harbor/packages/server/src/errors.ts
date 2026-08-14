import type { ApiError, ErrorCode } from '@rowboat/spaces-protocol';

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_path: 400,
  payload_too_large: 413,
  read_only_limit: 403,
  rate_limited: 429,
  invalid_request: 400,
  internal: 500,
};

const RETRYABLE = new Set<ErrorCode>(['rate_limited', 'internal']);

/** Thrown by the service core; each face maps it to its own wire shape. */
export class HarborError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'HarborError';
    this.code = code;
    this.status = STATUS[code];
    this.retryable = RETRYABLE.has(code);
  }

  toBody(): ApiError {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}
