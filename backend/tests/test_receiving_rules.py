"""Test aturan inspeksi penerimaan (docs/design.md §3.5b + docs/Skill.md §9).

Logika murni: siapa yang boleh mencatat inspeksi, kapan boleh, dan bagaimana kondisi fisik
dipetakan ke `decisions.outcome`.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.receiving_rules import (
    CONDITIONS_TO_OUTCOME,
    ReceivingRuleError,
    outcome_for_condition,
    validate_receiving,
)

RECEIVING = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTHER = uuid.UUID("22222222-2222-2222-2222-222222222222")


def _validate(**overrides):
    kwargs = dict(
        decision_status="executed",
        current_outcome="pending",
        recorder_role="sppg_nutritionist",
        recorder_location_id=RECEIVING,
        target_location_id=RECEIVING,
    )
    kwargs.update(overrides)
    return validate_receiving(**kwargs)


def test_physical_conditions_map_to_outcome():
    assert CONDITIONS_TO_OUTCOME == {
        "baik": "success",
        "rusak_sebagian": "failure",
        "rusak": "failure",
    }
    assert outcome_for_condition("baik") == "success"
    assert outcome_for_condition("rusak_sebagian") == "failure"
    assert outcome_for_condition("rusak") == "failure"


def test_unknown_condition_is_rejected():
    with pytest.raises(ValueError, match="kondisi"):
        outcome_for_condition("lumayan")


def test_nutritionist_from_the_receiving_sppg_may_record():
    _validate()  # tidak melempar


def test_head_of_sppg_does_not_record_the_inspection():
    """§9: yang mencatat inspeksi penerimaan adalah ahli gizi, bukan kepala SPPG."""
    with pytest.raises(ReceivingRuleError) as exc:
        _validate(recorder_role="sppg_head")

    assert exc.value.code == "recorder_role_not_allowed"


def test_bgn_monitor_does_not_record_the_inspection():
    with pytest.raises(ReceivingRuleError) as exc:
        _validate(recorder_role="bgn_monitor", recorder_location_id=None)

    assert exc.value.code == "recorder_role_not_allowed"


def test_recorder_must_be_at_the_receiving_sppg():
    with pytest.raises(ReceivingRuleError) as exc:
        _validate(recorder_location_id=OTHER)

    assert exc.value.code == "recorder_location_mismatch"


def test_decision_must_be_executed_before_goods_can_be_received():
    with pytest.raises(ReceivingRuleError) as exc:
        _validate(decision_status="approved")

    assert exc.value.code == "decision_not_executed"


def test_decision_cannot_be_received_twice():
    with pytest.raises(ReceivingRuleError) as exc:
        _validate(current_outcome="success")

    assert exc.value.code == "already_received"


def test_missing_target_location_cannot_be_received():
    with pytest.raises(ReceivingRuleError) as exc:
        _validate(target_location_id=None)

    assert exc.value.code == "decision_target_missing"
