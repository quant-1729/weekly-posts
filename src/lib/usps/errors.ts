export type FieldErrors = Record<string, string>;

export class UspValidationError extends Error {
  constructor(public readonly fieldErrors: FieldErrors) {
    super("USP is invalid");
    this.name = "UspValidationError";
  }
}

export class UspNotFoundError extends Error {
  constructor() {
    super("USP not found");
    this.name = "UspNotFoundError";
  }
}

export class UspLimitError extends Error {
  constructor() {
    super("Too many selling points");
    this.name = "UspLimitError";
  }
}
