// Not a DomainError: retrying with fresh data can succeed, so the message is redelivered
// instead of going to the dead letter topic.
export class ConcurrentModificationError extends Error {}
