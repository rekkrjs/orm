/** Data is already committed; retry the failed effects, never the transaction. */
export class AfterCommitError extends AggregateError {
  readonly committed = true;
  constructor(errors: unknown[]) {
    super(errors, "Transaction committed, but one or more afterCommit callbacks failed.");
    this.name = "AfterCommitError";
  }
}
