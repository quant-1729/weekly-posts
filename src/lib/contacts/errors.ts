export class ContactValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Contact is invalid');
    this.name = 'ContactValidationError';
  }
}

export class ContactNotFoundError extends Error {
  constructor() {
    super('Contact not found');
    this.name = 'ContactNotFoundError';
  }
}

/** The brand already has this contact, or already has the only one of a kind (hours). */
export class ContactDuplicateError extends Error {
  constructor(public readonly single = false) {
    super('Contact already exists');
    this.name = 'ContactDuplicateError';
  }
}

export class ContactLimitError extends Error {
  constructor() {
    super('Too many contacts');
    this.name = 'ContactLimitError';
  }
}
