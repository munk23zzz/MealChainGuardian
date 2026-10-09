"""Test aturan approval — logika murni, tanpa HTTP dan tanpa database.

Sumber aturan: `docs/Schema.md` §3 (kontrak status) & §6 (catatan integritas) dan
`docs/PRD.md` §5 ("approver SPPG approve atau reject").
Ditulis sebelum implementasi ada, supaya yang diuji adalah aturan dokumen, bukan kode yang sudah jadi.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.approval_rules import (
    ApprovalRuleError,
    ApprovalVote,
    decision_status_after,
    is_satisfied,
    missing_roles,
    required_approvals,
    required_roles,
    validate_vote,
)

HEAD = "sppg_head"
NUTRITIONIST = "sppg_nutritionist"
MONITOR = "bgn_monitor"

RECEIVING_LOCATION = uuid.UUID("11111111-1111-1111-1111-111111111111")
OTHER_LOCATION = uuid.UUID("22222222-2222-2222-2222-222222222222")

HEAD_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000001")
NUTRI_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000002")
MONITOR_ID = uuid.UUID("aaaaaaaa-0000-0000-0000-000000000003")


def _vote(approver_id=HEAD_ID, role=HEAD, approved=True) -> ApprovalVote:
    return ApprovalVote(approver_id=approver_id, role=role, approved=approved)


def _validate(**overrides):
    """Panggil validate_vote dengan nilai sah, lalu timpa sesuai kebutuhan test."""
    kwargs = dict(
        status="pending_approval",
        expired=False,
        approver_id=HEAD_ID,
        approver_role=HEAD,
        approver_location_id=RECEIVING_LOCATION,
        target_location_id=RECEIVING_LOCATION,
        votes=(),
    )
    kwargs.update(overrides)
    return validate_vote(**kwargs)


# --- jumlah dan jenis approval (Skill.md §9) -------------------------------------------


def test_required_approvals_matches_approval_matrix():
    assert required_approvals("pending_approval") == 1
    assert required_approvals("verifier_flagged") == 2


@pytest.mark.parametrize("status", ["verifier_unavailable", "expired"])
def test_statuses_dropped_on_9_okt_are_no_longer_approvable(status):
    """`verifier_unavailable` dan `expired` dihapus dari kontrak status (docs/Schema.md §3,
    revisi 9 Okt) — keduanya sekarang ditolak sebagai status yang tidak menunggu approval."""
    with pytest.raises(ApprovalRuleError) as exc:
        required_approvals(status)
    assert exc.value.code == "decision_not_approvable"


@pytest.mark.parametrize(
    "status", ["proposed", "approved", "rejected", "executed", "status_karangan"]
)
def test_required_approvals_rejects_status_that_is_not_awaiting_approval(status):
    with pytest.raises(ApprovalRuleError) as exc:
        required_approvals(status)
    assert exc.value.code == "decision_not_approvable"


def test_both_roles_are_required_only_when_two_approvals_are_needed():
    assert required_roles("pending_approval") == frozenset()
    assert required_roles("verifier_flagged") == frozenset({HEAD, NUTRITIONIST})


# --- siapa yang sah approve -------------------------------------------------------------


def test_bgn_monitor_never_approves():
    with pytest.raises(ApprovalRuleError) as exc:
        _validate(approver_id=MONITOR_ID, approver_role=MONITOR)

    assert exc.value.code == "approver_role_not_allowed"


def test_approver_must_be_from_the_receiving_sppg():
    with pytest.raises(ApprovalRuleError) as exc:
        _validate(approver_location_id=OTHER_LOCATION)

    assert exc.value.code == "approver_location_mismatch"


def test_approver_without_location_is_rejected():
    with pytest.raises(ApprovalRuleError) as exc:
        _validate(approver_location_id=None)

    assert exc.value.code == "approver_location_mismatch"


def test_decision_without_target_location_cannot_be_approved():
    with pytest.raises(ApprovalRuleError) as exc:
        _validate(target_location_id=None)

    assert exc.value.code == "decision_target_missing"


def test_same_person_cannot_approve_twice():
    with pytest.raises(ApprovalRuleError) as exc:
        _validate(votes=(_vote(),))

    assert exc.value.code == "duplicate_approver"


def test_vote_on_decision_not_awaiting_approval_is_rejected():
    with pytest.raises(ApprovalRuleError) as exc:
        _validate(status="executed")

    assert exc.value.code == "decision_not_approvable"


def test_expired_decision_cannot_be_approved():
    with pytest.raises(ApprovalRuleError) as exc:
        _validate(expired=True)

    assert exc.value.code == "decision_expired"


# --- kepuasan dan transisi status -------------------------------------------------------


def test_single_approval_is_enough_when_verifier_is_consistent():
    assert is_satisfied("pending_approval", [_vote()]) is True


def test_two_votes_from_the_same_role_do_not_satisfy_flagged_decision():
    """Dua 'sppg_head' bukan dua approval: yang kedua peran itu memang tidak pernah mulai."""
    votes = [_vote(HEAD_ID), _vote(uuid.UUID(int=7))]

    assert is_satisfied("verifier_flagged", votes) is False
    assert missing_roles("verifier_flagged", votes) == frozenset({NUTRITIONIST})


def test_head_and_nutritionist_satisfy_flagged_decision():
    votes = [_vote(HEAD_ID, HEAD), _vote(NUTRI_ID, NUTRITIONIST)]

    assert is_satisfied("verifier_flagged", votes) is True
    assert missing_roles("verifier_flagged", votes) == frozenset()


def test_partial_approval_does_not_change_status():
    """Status tetap 'verifier_flagged' setelah satu approval, supaya jumlah yang dibutuhkan
    tidak pernah turun jadi satu hanya karena status diganti di tengah jalan."""
    assert decision_status_after("verifier_flagged", [_vote()]) == "verifier_flagged"


def test_enough_approvals_move_status_to_approved():
    votes = [_vote(HEAD_ID, HEAD), _vote(NUTRI_ID, NUTRITIONIST)]

    assert decision_status_after("verifier_flagged", votes) == "approved"
    assert decision_status_after("pending_approval", [_vote()]) == "approved"


def test_any_rejection_rejects_the_decision_immediately():
    votes = [_vote(NUTRI_ID, NUTRITIONIST, approved=False)]

    assert decision_status_after("verifier_flagged", votes) == "rejected"
    assert is_satisfied("verifier_flagged", votes) is False


def test_rejection_wins_even_when_approvals_are_already_enough():
    votes = [_vote(HEAD_ID, HEAD), _vote(NUTRI_ID, NUTRITIONIST, approved=False)]

    assert decision_status_after("verifier_flagged", votes) == "rejected"


def test_missing_roles_lists_every_role_still_needed():
    assert missing_roles("verifier_flagged", []) == frozenset({HEAD, NUTRITIONIST})
    assert missing_roles("pending_approval", []) == frozenset()
