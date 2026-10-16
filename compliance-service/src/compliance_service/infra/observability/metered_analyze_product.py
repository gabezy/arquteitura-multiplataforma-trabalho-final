import time
from dataclasses import dataclass

from opentelemetry.metrics import Counter, Histogram, Meter

from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.core.product.port.in_.analyze_product_port import AnalyzeProductPort


@dataclass(frozen=True)
class AnalysisInstruments:
    analyses: Counter
    violations: Counter
    duration: Histogram

    @classmethod
    def create(cls, meter: Meter) -> "AnalysisInstruments":
        return cls(
            analyses=meter.create_counter("compliance.analyses", description="Product analyses by status"),
            violations=meter.create_counter("compliance.rule.violations", description="Violations by rule"),
            duration=meter.create_histogram(
                "compliance.analysis.duration", unit="s", description="Time to analyse a product"
            ),
        )


class MeteredAnalyzeProduct:
    """Records analysis metrics around the core port, so the core stays free of OpenTelemetry."""

    def __init__(self, inner: AnalyzeProductPort, instruments: AnalysisInstruments) -> None:
        self._inner = inner
        self._instruments = instruments

    async def analyze(self, product: Product) -> ProductAnalysis:
        started = time.perf_counter()
        analysis = await self._inner.analyze(product)
        self._instruments.duration.record(time.perf_counter() - started)
        self._instruments.analyses.add(1, {"status": analysis.status.value})
        for violation in analysis.violations:
            self._instruments.violations.add(1, {"rule_code": violation.rule_code})
        return analysis
