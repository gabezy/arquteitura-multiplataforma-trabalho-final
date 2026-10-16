from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from compliance_service.core.product.model.rules.compliance_handler import ComplianceHandler, build_chain
from compliance_service.core.product.model.rules.description_required_rule import DescriptionRequiredRule
from compliance_service.core.product.model.rules.price_ceiling_rule import PriceCeilingRule
from compliance_service.core.product.model.rules.prohibited_terms_rule import ProhibitedTermsRule
from compliance_service.core.product.port.out.analysis_result_publisher import AnalysisResultPublisher
from compliance_service.core.product.port.out.clock import Clock
from compliance_service.core.product.product_facade import ProductFacade
from compliance_service.infra.config.settings import Settings
from compliance_service.infra.messaging.inbox_store import SqlAlchemyInboxStore
from compliance_service.infra.messaging.unit_of_work import MessageUnitOfWork, UnitOfWorkFactory
from compliance_service.infra.observability.metered_analyze_product import AnalysisInstruments, MeteredAnalyzeProduct
from compliance_service.infra.persistence.sqlalchemy_product_analysis_repository import (
    SqlAlchemyProductAnalysisRepository,
)
from compliance_service.infra.persistence.sqlalchemy_unit_of_work import SqlAlchemyUnitOfWork


def build_rules(settings: Settings) -> ComplianceHandler:
    return build_chain(
        ProhibitedTermsRule(),
        PriceCeilingRule(settings.price_ceiling),
        DescriptionRequiredRule(settings.description_min_length),
    )


def build_unit_of_work_factory(
    session_factory: async_sessionmaker[AsyncSession],
    rules: ComplianceHandler,
    publisher: AnalysisResultPublisher,
    clock: Clock,
    instruments: AnalysisInstruments,
) -> UnitOfWorkFactory:
    @asynccontextmanager
    async def open_unit_of_work() -> AsyncIterator[MessageUnitOfWork]:
        async with session_factory() as session:
            facade = ProductFacade(rules, SqlAlchemyProductAnalysisRepository(session), publisher, clock)
            yield SqlAlchemyUnitOfWork(
                session=session,
                inbox=SqlAlchemyInboxStore(session),
                analyze_product=MeteredAnalyzeProduct(facade, instruments),
            )

    return open_unit_of_work
