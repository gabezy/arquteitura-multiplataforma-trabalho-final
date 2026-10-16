from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.violation import Violation


class AnalysisStatus(StrEnum):
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


@dataclass(frozen=True)
class ProductAnalysis:
    id: UUID
    product_id: str
    sku: str
    status: AnalysisStatus
    violations: tuple[Violation, ...]
    analyzed_at: datetime

    @classmethod
    def of(cls, product: Product, report: ComplianceReport, now: datetime) -> "ProductAnalysis":
        status = AnalysisStatus.REJECTED if report.has_violations else AnalysisStatus.APPROVED
        return cls(
            id=uuid4(),
            product_id=product.product_id,
            sku=product.sku,
            status=status,
            violations=report.violations,
            analyzed_at=now,
        )
