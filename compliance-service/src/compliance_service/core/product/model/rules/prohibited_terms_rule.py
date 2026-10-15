import re
import unicodedata
from collections.abc import Iterable

from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.rules.compliance_handler import ComplianceHandler
from compliance_service.core.product.model.violation import Violation

DEFAULT_PROHIBITED_TERMS: tuple[str, ...] = (
    # weapons
    "arma de fogo", "pistola", "revólver", "fuzil", "munição", "firearm", "pistol", "ammunition",
    # drugs
    "cocaína", "maconha", "heroína", "crack", "lsd", "cocaine", "marijuana", "heroin",
    # counterfeit goods
    "falsificado", "falsificada", "réplica", "pirata", "counterfeit",
    # controlled medicines
    "anabolizante", "esteroide", "rivotril", "oxicodona", "steroid", "oxycodone",
)  # fmt: skip


def _normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


class ProhibitedTermsRule(ComplianceHandler):
    code = "PROHIBITED_TERMS"
    blocking = True

    def __init__(self, terms: Iterable[str] = DEFAULT_PROHIBITED_TERMS) -> None:
        super().__init__()
        normalized = sorted({_normalize(term) for term in terms if term.strip()}, key=len, reverse=True)
        self._pattern = re.compile(r"\b(" + "|".join(map(re.escape, normalized)) + r")\b") if normalized else None

    def _check(self, product: Product) -> Violation | None:
        if self._pattern is None:
            return None
        found = sorted(set(self._pattern.findall(_normalize(f"{product.name}\n{product.description}"))))
        if not found:
            return None
        return Violation(self.code, f"Name or description contains prohibited terms: {', '.join(found)}.")
