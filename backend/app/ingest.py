"""Menarik stok dari SAP (lewat provider) dan menyimpannya sebagai `supply_records` domain.

Ini jembatan terakhir antara istilah SAP dan tabel domain (docs/Schema.md §2 + docs/Skill.md §7):
  API_MATERIAL_STOCK -> mapping.to_supply_snapshots -> supply_records(location_id, commodity_id,
  quantity_kg, recorded_at, source='mock_sap')

Semantiknya snapshot: baris lama dengan `source='mock_sap'` dihapus dulu, lalu ditulis ulang. Baris
manual/sensor tidak disentuh.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Commodity, Location, SupplyRecord
from app.sap_integration.mapping import to_supply_snapshots
from app.sap_integration.provider_interface import SAPDataProvider, SAPProviderError

MOCK_SAP_SOURCE = "mock_sap"


def sync_supply_records(session: Session, provider: SAPDataProvider) -> int:
    """Tulis ulang `supply_records` dari data provider. Mengembalikan jumlah baris yang ditulis."""
    snapshots = to_supply_snapshots(provider.get_material_stock())

    locations = {row.name: row.id for row in session.scalars(select(Location)).all()}
    commodities = {row.name: row.id for row in session.scalars(select(Commodity)).all()}

    session.execute(delete(SupplyRecord).where(SupplyRecord.source == MOCK_SAP_SOURCE))

    recorded_at = datetime.now(UTC)
    written = 0
    for snapshot in snapshots:
        if snapshot.location not in locations:
            raise SAPProviderError(
                f"Lokasi {snapshot.location!r} belum ada di tabel `locations`; jalankan seed dulu "
                "(python -m app.db_seed)."
            )
        if snapshot.commodity not in commodities:
            raise SAPProviderError(
                f"Komoditas {snapshot.commodity!r} belum ada di tabel `commodities`; jalankan seed "
                "dulu (python -m app.db_seed)."
            )
        session.add(
            SupplyRecord(
                location_id=locations[snapshot.location],
                commodity_id=commodities[snapshot.commodity],
                quantity_kg=snapshot.quantity_kg,
                recorded_at=recorded_at,
                source=MOCK_SAP_SOURCE,
            )
        )
        written += 1

    session.commit()
    return written
