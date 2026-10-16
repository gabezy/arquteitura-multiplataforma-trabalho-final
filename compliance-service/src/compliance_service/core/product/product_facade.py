from compliance_service.core.product.model.compliance_report import ComplianceReport
from compliance_service.core.product.model.product import Product
from compliance_service.core.product.model.product_analysis import ProductAnalysis
from compliance_service.core.product.model.rules.compliance_handler import ComplianceHandler
from compliance_service.core.product.port.out.analysis_result_publisher import AnalysisResultPublisher
from compliance_service.core.product.port.out.clock import Clock
from compliance_service.core.product.port.out.product_analysis_repository import ProductAnalysisRepository


class ProductFacade:
    def __init__(
        self,
        rules: ComplianceHandler,
        repository: ProductAnalysisRepository,
        publisher: AnalysisResultPublisher,
        clock: Clock,
    ) -> None:
        self._rules = rules
        self._repository = repository
        self._publisher = publisher
        self._clock = clock

    async def analyze(self, product: Product) -> ProductAnalysis:
        report = self._rules.handle(product, ComplianceReport())
        analysis = ProductAnalysis.of(product, report, self._clock.now())
        await self._publisher.publish(analysis)
        await self._repository.save(analysis)
        return analysis
