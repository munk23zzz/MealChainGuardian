"""Aturan inspeksi penerimaan (Receiving Inspection) — `docs/design.md` §3.5b, `docs/Skill.md` §9.

Logika murni: siapa yang boleh mencatat, kapan boleh, dan bagaimana kondisi fisik dipetakan ke
`decisions.outcome`. Penegakannya di `app/api/actions.py`, tapi aturannya hidup di sini supaya bisa
diuji tanpa HTTP dan tanpa database.
"""

from __future__ import annotations

import uuid

# Kondisi fisik dari form §3.5b -> outcome keputusan (§10 poin 1).
# Dua kondisi rusak sama-sama `failure`: yang membedakan tingkat kerusakan ada di catatan/bukti,
# bukan di status keputusan.
CONDITIONS_TO_OUTCOME: dict[str, str] = {
    "baik": "success",
    "rusak_sebagian": "failure",
    "rusak": "failure",
}

# Yang mencatat inspeksi penerimaan adalah ahli gizi SPPG penerima (docs/Skill.md §9).
RECORDER_ROLES = ("sppg_nutritionist",)


class ReceivingRuleError(Exception):
    """Pelanggaran aturan penerimaan; `code` dipetakan ke kode HTTP oleh lapisan API."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def outcome_for_condition(condition: str) -> str:
    """`success`/`failure` untuk satu kondisi fisik. Gagal keras kalau kondisinya tak dikenal."""
    try:
        return CONDITIONS_TO_OUTCOME[condition]
    except KeyError:
        raise ValueError(
            f"kondisi {condition!r} tidak dikenal. Yang sah: {', '.join(CONDITIONS_TO_OUTCOME)}"
        ) from None


def validate_receiving(
    *,
    decision_status: str,
    current_outcome: str | None,
    recorder_role: str,
    recorder_location_id: uuid.UUID | None,
    target_location_id: uuid.UUID | None,
) -> None:
    """Periksa apakah inspeksi ini sah. Melempar `ReceivingRuleError` kalau tidak."""
    if decision_status != "executed":
        raise ReceivingRuleError(
            "decision_not_executed",
            f"Keputusan berstatus {decision_status!r}: barang baru bisa diterima setelah PO "
            "dieksekusi (docs/Skill.md §10 poin 1).",
        )

    if current_outcome not in (None, "pending"):
        raise ReceivingRuleError(
            "already_received",
            f"Keputusan ini sudah punya hasil {current_outcome!r}. Inspeksi ulang dicatat sebagai "
            "bukti baru, bukan dengan menimpa hasil yang sudah ada.",
        )

    if target_location_id is None:
        raise ReceivingRuleError(
            "decision_target_missing",
            "Keputusan tidak punya lokasi penerima, jadi tidak jelas SPPG mana yang menerima barang.",
        )

    if recorder_role not in RECORDER_ROLES:
        raise ReceivingRuleError(
            "recorder_role_not_allowed",
            f"Peran {recorder_role!r} tidak mencatat inspeksi penerimaan (docs/Skill.md §9). "
            f"Yang sah: {', '.join(RECORDER_ROLES)}.",
        )

    if recorder_location_id is None or recorder_location_id != target_location_id:
        raise ReceivingRuleError(
            "recorder_location_mismatch",
            "Inspeksi penerimaan dicatat oleh staf SPPG penerima, bukan SPPG lain.",
        )
