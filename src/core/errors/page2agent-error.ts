import { userSafeMessage } from "./error-codes";
import type { Page2AgentErrorCode } from "./error-codes";

/**
 * Structured domain error. `message` defaults to the user-safe message for the
 * code; `cause` is internal-only and must never be serialized into a UI DTO.
 * Never store webpage content in domain errors.
 */
export class Page2AgentError extends Error {
  readonly code: Page2AgentErrorCode;
  override readonly cause?: unknown;

  constructor(
    code: Page2AgentErrorCode,
    options: { message?: string; cause?: unknown } = {},
  ) {
    super(options.message ?? userSafeMessage(code));
    this.name = "Page2AgentError";
    this.code = code;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
