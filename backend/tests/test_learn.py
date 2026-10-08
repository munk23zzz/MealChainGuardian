"""Test LEARN — penyesuaian `reliability_score` (docs/Skill.md §10).

Ini logika deterministik biasa, bukan model AI yang dilatih ulang. Test ditulis sebelum
implementasi ada, supaya yang diuji formulanya, bukan kode yang sudah jadi.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.core.learn import LEARN_WINDOW, adjusted_reliability, success_rate


def test_window_matches_documented_tuning_knob():
    """§10 menyebut 'success_rate_N_terakhir' tanpa angka, jadi N adalah knob yang harus eksplisit."""
    assert LEARN_WINDOW == 5


def test_success_rate_counts_only_decided_outcomes():
    outcomes = ["success", "failure", "success", None, "pending"]

    assert success_rate(outcomes) == Decimal("0.6667")


def test_success_rate_of_nothing_decided_is_none():
    assert success_rate([None, "pending"]) is None


def test_unknown_outcome_is_rejected_loudly():
    with pytest.raises(ValueError, match="outcome"):
        success_rate(["success", "success_terus"])


def test_only_the_last_n_outcomes_count():
    """Urutan lama -> baru; yang dipakai hanya N terakhir."""
    old_failures = ["failure"] * 5
    recent_successes = ["success"] * 5

    assert success_rate(old_failures + recent_successes) == Decimal("1")


def test_window_is_parameterised():
    assert success_rate(["failure", "success", "success"], window=2) == Decimal("1")
    assert success_rate(["failure", "success", "success"], window=3) == Decimal("0.6667")


def test_formula_follows_skill_md_section_10():
    """0.5 x lama + 0.5 x success_rate, semua success."""
    assert adjusted_reliability(Decimal("0.80"), ["success"] * 5) == Decimal("0.90")


def test_formula_on_failure_lowers_the_score():
    assert adjusted_reliability(Decimal("0.80"), ["failure"] * 5) == Decimal("0.40")


def test_mixed_history_moves_the_score_proportionally():
    outcomes = ["success", "success", "success", "failure", "failure"]

    assert adjusted_reliability(Decimal("0.80"), outcomes) == Decimal("0.70")


def test_score_is_clamped_between_zero_and_one():
    # dibulatkan 2 desimal (kolom NUMERIC(3,2)), jadi 0.495 -> 0.50
    assert adjusted_reliability(Decimal("0.99"), ["failure"] * 5) == Decimal("0.50")
    assert adjusted_reliability(Decimal("0.05"), ["success"] * 5) == Decimal("0.53")
    assert adjusted_reliability(Decimal("0.00"), ["failure"] * 5) == Decimal("0.00")
    assert adjusted_reliability(Decimal("1.00"), ["success"] * 5) == Decimal("1.00")


def test_score_without_decided_outcomes_stays_put():
    assert adjusted_reliability(Decimal("0.80"), []) == Decimal("0.80")
    assert adjusted_reliability(Decimal("0.80"), [None, "pending"]) == Decimal("0.80")


def test_score_is_rounded_to_two_decimals_to_fit_the_column():
    """`suppliers.reliability_score` bertipe NUMERIC(3,2) — jangan kirim tiga desimal ke sana."""
    result = adjusted_reliability(Decimal("0.83"), ["success", "failure"])

    assert result == Decimal("0.67")
    assert -result.as_tuple().exponent <= 2


def test_score_never_exceeds_one_even_when_rounding_up():
    assert adjusted_reliability(Decimal("0.999"), ["success"] * 5) == Decimal("1.00")
