import type { MissingItem } from './completeness';

export class BriefValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super('Brief is invalid');
    this.name = 'BriefValidationError';
  }
}

export class BriefNotFoundError extends Error {
  constructor() {
    super('Brief not found');
    this.name = 'BriefNotFoundError';
  }
}

/** Thrown when a brief is set to "ready" while required items are missing. */
export class BriefIncompleteError extends Error {
  constructor(public readonly missing: MissingItem[]) {
    super('Brief is incomplete');
    this.name = 'BriefIncompleteError';
  }
}
