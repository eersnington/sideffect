export class NonRetryableError extends Error {
  override readonly name = "NonRetryableError";
}
