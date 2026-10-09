"""aturan approval — logika murni, tidak tahu HTTP maupun database.

Sumber tunggal: `docs/Schema.md` §3 & §6 (kontrak status + catatan integritas) dan
`docs/PRD.md` §5 ("approver SPPG approve atau reject aksi berisiko tinggi sebelum eksekusi;
`bgn_monitor` read-only"). Modul ini sengaja tidak menyentuh ORM supaya bisa diuji tanpa Postgres,
dan supaya aturannya bisa dibaca sebagai aturan — bukan tersebar di dalam endpoint.

Dua keputusan desain yang penting:

1. **Status keputusan adalah sumber kebenaran jumlah approval.** `pending_approval` butuh 1,
   `verifier_flagged` butuh 2. Approval pertama pada keputusan yang butuh dua TIDAK mengubah
   status (kalau diturunkan jadi `pending_approval`, syaratnya akan salah terbaca sebagai
   "cukup satu").
2. **Dua approval pada status yang butuh dua bukan berarti "dua orang",** melainkan satu
   `sppg_head` DAN satu `sppg_nutritionist` dari SPPG penerima.

Catatan revisi dokumen 9 Okt: status `verifier_unavailable` DIHAPUS dari kontrak
(`docs/Schema.md` §3), jadi jalur "verifier gagal total → wajib dua approval" tidak ada lagi.
Verifier yang tidak tersedia kini berarti keputusan tetap `proposed` dan belum bisa di-approve
sama sekali — lebih ketat, bukan lebih longgar.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Iterable, Sequence

# Peran yang boleh meng-approve. `bgn_monitor` tidak pernah ada di sini — dia read-only.
APPROVER_ROLES = ("sppg_head", "sppg_nutritionist")

# Status keputusan yang sedang menunggu approval (`docs/Schema.md` §3, revisi 9 Okt).
APPROVABLE_STATUSES = ("pending_approval", "verifier_flagged")

REQUIRED_APPROVALS: dict[str, int] = {
    "pending_approval": 1,
    "verifier_flagged": 2,
}

# Status yang menuntut peran tertentu (head DAN nutritionist), bukan sekadar jumlah orang.
STATUSES_REQUIRING_BOTH_ROLES = ("verifier_flagged",)


class ApprovalRuleError(Exception):
    """Pelanggaran aturan approval. `code` dipetakan ke kode HTTP oleh lapisan API."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ApprovalVote:
    """Satu suara approval, sudah tersimpan atau akan tersimpan."""

    approver_id: uuid.UUID
    role: str
    approved: bool


def required_approvals(status: str) -> int:
    """Berapa approval yang dibutuhkan untuk status ini (`docs/Schema.md` §3)."""
    try:
        return REQUIRED_APPROVALS[status]
    except KeyError:
        raise ApprovalRuleError(
            "decision_not_approvable",
            f"Keputusan berstatus {status!r} tidak sedang menunggu approval. "
            f"Yang menunggu approval: {', '.join(APPROVABLE_STATUSES)}.",
        ) from None


def required_roles(status: str) -> frozenset[str]:
    """Peran yang WAJIB terwakili. Kosong = peran apa pun yang sah sudah cukup."""
    required_approvals(status)  # memvalidasi status
    if status in STATUSES_REQUIRING_BOTH_ROLES:
        return frozenset(APPROVER_ROLES)
    return frozenset()


def validate_vote(
    *,
    status: str,
    expired: bool,
    approver_id: uuid.UUID,
    approver_role: str,
    approver_location_id: uuid.UUID | None,
    target_location_id: uuid.UUID | None,
    votes: Sequence[ApprovalVote],
) -> None:
    """Periksa apakah suara ini sah. Melempar `ApprovalRuleError` kalau tidak.

    Urutan pemeriksaan sengaja dari yang paling umum ke paling spesifik, supaya pesan errornya
    berguna: status dulu, lalu kedaluwarsa, lalu identitas SPPG, baru aturan per orang.
    """
    needed = required_approvals(status)

    if expired:
        raise ApprovalRuleError(
            "decision_expired",
            "Keputusan sudah lewat masa berlaku (expires_at) dan tidak boleh di-approve; "
            "Supervisor harus mengulang dari DETECT dengan data terbaru (`docs/Schema.md` §3).",
        )

    if target_location_id is None:
        raise ApprovalRuleError(
            "decision_target_missing",
            "Keputusan tidak punya lokasi penerima (target_location_id), jadi tidak ada SPPG yang "
            "berhak meng-approve.",
        )

    if approver_role not in APPROVER_ROLES:
        raise ApprovalRuleError(
            "approver_role_not_allowed",
            f"Peran {approver_role!r} tidak boleh meng-approve pembelian (`docs/Schema.md` §3). "
            f"Yang sah: {', '.join(APPROVER_ROLES)}.",
        )

    if approver_location_id is None or approver_location_id != target_location_id:
        raise ApprovalRuleError(
            "approver_location_mismatch",
            "Approver harus berasal dari SPPG penerima (lokasi tujuan keputusan), bukan SPPG lain "
            "dan bukan lintas lokasi (`docs/Schema.md` §3).",
        )

    if any(vote.approver_id == approver_id for vote in votes):
        raise ApprovalRuleError(
            "duplicate_approver",
            "Orang yang sama tidak bisa approve dua kali untuk keputusan yang sama "
            "(unique index (decision_id, approved_by), docs/Schema.md §6).",
        )

    if needed > 0 and _approved_votes(status, votes) and any(
        not vote.approved for vote in votes
    ):
        raise ApprovalRuleError(
            "decision_rejected",
            "Keputusan ini sudah ditolak; penolakan tidak bisa ditimpa dengan approval.",
        )


def _approved_votes(status: str, votes: Iterable[ApprovalVote]) -> list[ApprovalVote]:
    """Suara yang dihitung: `approved`, perannya sah, dan satu suara per orang."""
    seen: set[uuid.UUID] = set()
    counted: list[ApprovalVote] = []
    for vote in votes:
        if not vote.approved or vote.role not in APPROVER_ROLES:
            continue
        if vote.approver_id in seen:
            continue
        seen.add(vote.approver_id)
        counted.append(vote)
    return counted


def is_rejected(votes: Iterable[ApprovalVote]) -> bool:
    """Satu penolakan dari approver sah mana pun sudah cukup (`docs/Schema.md` §3)."""
    return any(not vote.approved and vote.role in APPROVER_ROLES for vote in votes)


def is_satisfied(status: str, votes: Sequence[ApprovalVote]) -> bool:
    """Sudah cukup approval untuk status ini?"""
    if status not in APPROVABLE_STATUSES:
        return False
    if is_rejected(votes):
        return False

    approved = _approved_votes(status, votes)
    if len(approved) < REQUIRED_APPROVALS[status]:
        return False

    return required_roles(status) <= {vote.role for vote in approved}


def missing_roles(status: str, votes: Sequence[ApprovalVote]) -> frozenset[str]:
    """Peran yang masih dibutuhkan. Kosong = tidak ada peran tertentu yang kurang."""
    if status not in APPROVABLE_STATUSES:
        return frozenset()
    return required_roles(status) - {vote.role for vote in _approved_votes(status, votes)}


def decision_status_after(status: str, votes: Sequence[ApprovalVote]) -> str:
    """Status keputusan setelah suara-suara ini.

    Penolakan menang lebih dulu; lalu kelengkapan approval; kalau belum, status tidak berubah.
    """
    if is_rejected(votes):
        return "rejected"
    if is_satisfied(status, votes):
        return "approved"
    return status
