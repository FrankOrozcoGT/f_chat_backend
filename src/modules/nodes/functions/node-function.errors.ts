export class PostCodeRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostCodeRetryError';
  }
}
