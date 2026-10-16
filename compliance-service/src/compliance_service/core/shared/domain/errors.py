class DomainError(Exception):
    """Base class for every error raised by the core."""


class ValidationError(DomainError):
    """A value or invariant is invalid."""


class NotFoundError(DomainError):
    """The requested entity does not exist."""


class ConflictError(DomainError):
    """A valid operation clashes with the current state."""
