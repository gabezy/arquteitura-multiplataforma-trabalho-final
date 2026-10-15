from decimal import Decimal

from compliance_service.core.product.model.rules.description_required_rule import DescriptionRequiredRule
from compliance_service.core.product.model.rules.price_ceiling_rule import PriceCeilingRule
from compliance_service.core.product.model.rules.prohibited_terms_rule import ProhibitedTermsRule


def check(rule, product):
    return rule._check(product)


class TestProhibitedTermsRule:
    def test_flags_a_term_in_the_name(self, make_product):
        violation = check(ProhibitedTermsRule(), make_product(name="Pistola de airsoft"))

        assert violation.rule_code == "PROHIBITED_TERMS"
        assert "pistola" in violation.message

    def test_flags_a_term_in_the_description(self, make_product):
        violation = check(ProhibitedTermsRule(), make_product(description="Tênis réplica idêntico ao original"))

        assert "replica" in violation.message

    def test_ignores_case_and_accents(self, make_product):
        assert check(ProhibitedTermsRule(), make_product(name="Caixa de MUNIÇÃO")) is not None

    def test_matches_whole_words_only(self, make_product):
        assert check(ProhibitedTermsRule(), make_product(name="Biscoito crackers integral")) is None

    def test_matches_multi_word_terms(self, make_product):
        assert check(ProhibitedTermsRule(), make_product(description="Réplica de arma de fogo antiga")) is not None

    def test_lists_every_term_found_once_and_sorted(self, make_product):
        product = make_product(name="Pistola pistola", description="com munição")

        violation = check(ProhibitedTermsRule(), product)

        assert violation.message == "Name or description contains prohibited terms: municao, pistola."

    def test_accepts_custom_terms(self, make_product):
        rule = ProhibitedTermsRule(terms=["cadeira"])

        assert check(rule, make_product()) is not None

    def test_never_flags_with_an_empty_term_list(self, make_product):
        assert check(ProhibitedTermsRule(terms=[]), make_product(name="Pistola")) is None

    def test_approves_a_regular_product(self, make_product):
        assert check(ProhibitedTermsRule(), make_product()) is None

    def test_is_blocking(self):
        assert ProhibitedTermsRule.blocking is True


class TestPriceCeilingRule:
    def test_accepts_a_price_at_the_ceiling(self, make_product):
        assert check(PriceCeilingRule(Decimal("1000")), make_product(price=Decimal("1000"))) is None

    def test_flags_a_price_above_the_ceiling(self, make_product):
        violation = check(PriceCeilingRule(Decimal("1000")), make_product(price=Decimal("1000.01")))

        assert violation.rule_code == "PRICE_CEILING"
        assert violation.message == "Price 1000.01 exceeds the ceiling of 1000."

    def test_defaults_to_one_hundred_thousand(self, make_product):
        assert check(PriceCeilingRule(), make_product(price=Decimal("100000.01"))) is not None

    def test_is_not_blocking(self):
        assert PriceCeilingRule.blocking is False


class TestDescriptionRequiredRule:
    def test_accepts_a_description_at_the_minimum_length(self, make_product):
        assert check(DescriptionRequiredRule(5), make_product(description="abcde")) is None

    def test_flags_a_short_description(self, make_product):
        violation = check(DescriptionRequiredRule(5), make_product(description="abcd"))

        assert violation.rule_code == "DESCRIPTION_REQUIRED"
        assert violation.message == "Description must have at least 5 characters."

    def test_ignores_surrounding_whitespace(self, make_product):
        assert check(DescriptionRequiredRule(5), make_product(description="   ab   ")) is not None

    def test_flags_an_empty_description_by_default(self, make_product):
        assert check(DescriptionRequiredRule(), make_product(description="")) is not None

    def test_is_not_blocking(self):
        assert DescriptionRequiredRule.blocking is False
