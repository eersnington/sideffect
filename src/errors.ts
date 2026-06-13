export class NonRetryableError extends Error {
  override readonly name = "NonRetryableError";
}

export class RollbackError extends Error {
  override readonly name = "RollbackError";

  constructor(
    readonly failure: unknown,
    readonly rollbackFailures: ReadonlyArray<unknown>,
  ) {
    super(
      `Workflow failed and ${rollbackFailures.length} rollback handler${rollbackFailures.length === 1 ? "" : "s"} also failed. The original workflow failure is available on .failure.`,
    );
  }
}
