export class MissingAttributeError extends Error {
  constructor(
    public readonly model: string,
    public readonly attribute: string,
  ) {
    super(
      `The attribute [${attribute}] either does not exist or was not retrieved for model [${model}].`
    );
    this.name = "MissingAttributeError";
  }
}
