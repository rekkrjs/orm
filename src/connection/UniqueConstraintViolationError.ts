export class UniqueConstraintViolationError extends Error {
  constructor(options: ErrorOptions = {}) {
    super("A unique constraint was violated.", options);
    this.name = "UniqueConstraintViolationError";
  }
}
