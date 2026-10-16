from dataclasses import dataclass


@dataclass(frozen=True)
class Violation:
    rule_code: str
    message: str
