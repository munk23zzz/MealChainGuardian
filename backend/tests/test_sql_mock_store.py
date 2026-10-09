"""Test store mock SAP di Postgres.

Fokusnya: membuktikan data benar-benar tersimpan di database (bukan hanya di memori objek), bahwa
penomoran PO bertahan lintas instance, dan bahwa kolom ber-FK menolak nilai asal-asalan.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import pg_support
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Decision, SapMockMaterialStock, SapMockPurchaseOrder, Supplier, SupplyRecord
from app.sap_integration.mock_provider import MockSAPProvider
from app.sap_integration.provider_interface import (
    CreatePurchaseOrderRequest,
    SAPProviderError,
)


@pytest.fixture
def session_factory(pg_engine):
    return pg_support.session_factory()


@pytest.fixture
def session(session_factory):
    with session_factory() as session_:
        yield session_


@pytest.fixture
def provider(pg_engine) -> MockSAPProvider:
    return pg_support.build_sql_mock_provider()


def _request(
    supplier: str,
    *,
    material_number: str = "TELUR-01",
    order_quantity: Decimal = Decimal("700.00"),
    net_price: Decimal = Decimal("26200.00"),
    decision_reference: str | None = None,
) -> CreatePurchaseOrderRequest:
    return CreatePurchaseOrderRequest(
        Supplier=supplier,
        MaterialNumber=material_number,
        OrderQuantity=order_quantity,
        NetPriceAmount=net_price,
        PurchasingDocumentDate=date(2026, 10, 8),
        DecisionReference=decision_reference,
    )


def test_material_stock_is_read_from_postgres(provider, session):
    rows = provider.get_material_stock()

    # Baris baku §11 tetap jadi jangkar: kalau seed mengubah angka demo, test ini yang berteriak.
    by_batch = {r.Batch: r for r in rows}
    assert (by_batch["B-2026-0101"].Plant, by_batch["B-2026-0101"].MatlStkQty) == (
        "CJ01",
        Decimal("1400.00"),
    )
    assert (by_batch["B-2026-0102"].Plant, by_batch["B-2026-0102"].MatlStkQty) == (
        "JK01",
        Decimal("300.00"),
    )

    # Dan baris yang dibaca provider benar-benar isi tabel, bukan objek Python yang dikarang:
    # seluruh baris provider harus cocok dengan isi tabel (tau tak bergantung jumlah barisnya).
    stored = {
        batch: (material_number, quantity)
        for batch, material_number, quantity in session.execute(
            select(
                SapMockMaterialStock.batch,
                SapMockMaterialStock.material_number,
                SapMockMaterialStock.quantity,
            )
        ).all()
    }
    assert {r.Batch: (r.MaterialNumber, r.MatlStkQty) for r in rows} == stored


def test_purchase_order_is_written_to_postgres(provider, session):
    supplier = provider.get_business_partner()[0].BusinessPartner

    po = provider.create_purchase_order(_request(supplier))

    row = session.execute(
        select(SapMockPurchaseOrder).where(SapMockPurchaseOrder.po_number == po.PurchaseOrder)
    ).scalar_one()
    assert row.status == "submitted"
    assert row.ordered_quantity == Decimal("700.00")
    assert row.price == Decimal("26200.00")
    # Kolom FK tetap menyimpan `suppliers.id` (UUID domain), sedangkan dokumen SAP memuat kode.
    stored_supplier = session.get(Supplier, row.supplier_id)
    assert stored_supplier is not None
    assert stored_supplier.name == "Supplier A"
    # Baca ulang lewat provider mengembalikan KODE SAP (bentuk yang sama seperti provider memory).
    assert provider.get_purchase_orders(po_number=po.PurchaseOrder)[0].Supplier == supplier
    assert row.decision_id is None


def test_purchase_orders_persist_across_provider_instances(pg_engine, provider):
    supplier = provider.get_business_partner()[0].BusinessPartner
    first = provider.create_purchase_order(_request(supplier))

    # instance baru (proses/koneksi baru) tetap melihat PO itu, dan penomoran lanjut
    # reset=False: kita justru ingin membuktikan data bertahan, bukan dihapus untuk test.
    fresh = pg_support.build_sql_mock_provider(reset=False, seed=False)
    try:
        numbers = [p.PurchaseOrder for p in fresh.get_purchase_orders()]
        assert first.PurchaseOrder in numbers
        second = fresh.create_purchase_order(_request(supplier))
        assert second.PurchaseOrder != first.PurchaseOrder
        assert int(second.PurchaseOrder) == int(first.PurchaseOrder) + 1
    finally:
        fresh.close()


def test_decision_reference_must_be_a_real_decision_uuid(provider):
    supplier = provider.get_business_partner()[0].BusinessPartner

    with pytest.raises(SAPProviderError, match="(?i)uuid"):
        provider.create_purchase_order(_request(supplier, decision_reference="dec-002"))


def test_decision_reference_links_purchase_order_to_decision(provider, session):
    supplier = provider.get_business_partner()[0].BusinessPartner
    decision = Decision(decision_type="regional_balance")
    session.add(decision)
    session.commit()

    po = provider.create_purchase_order(
        _request(supplier, decision_reference=str(decision.id))
    )

    row = session.execute(
        select(SapMockPurchaseOrder).where(SapMockPurchaseOrder.po_number == po.PurchaseOrder)
    ).scalar_one()
    assert row.decision_id == decision.id
    assert provider.get_purchase_orders(decision_reference=str(decision.id))[0].PurchaseOrder == (
        po.PurchaseOrder
    )


def test_unknown_supplier_is_rejected(provider):
    """Kode business partner yang tidak ada di peta ditolak sebagai kesalahan provider."""
    with pytest.raises(SAPProviderError, match="(?i)business partner"):
        provider.create_purchase_order(_request("SUP-Z"))


def test_duplicate_po_number_is_rejected_by_the_database(provider, session):
    """UNIQUE di sap_mock_purchase_orders: invarian ditegakkan DB, bukan hanya kode Python."""
    supplier_id = session.scalar(select(Supplier.id).order_by(Supplier.name).limit(1))
    assert supplier_id is not None
    session.add(
        SapMockPurchaseOrder(
            po_number="4500000999",
            supplier_id=supplier_id,
            material_number="TELUR-01",
            ordered_quantity=Decimal("1.00"),
            price=Decimal("1.00"),
            status="draft",
        )
    )
    session.commit()

    session.add(
        SapMockPurchaseOrder(
            po_number="4500000999",
            supplier_id=supplier_id,
            material_number="TELUR-01",
            ordered_quantity=Decimal("2.00"),
            price=Decimal("2.00"),
            status="draft",
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_seed_ingest_writes_supply_records(provider, session):
    """Seed menjalankan tarikan SAP -> supply_records (source='mock_sap')."""
    rows = session.execute(select(SupplyRecord)).scalars().all()
    stored = session.execute(
        select(SapMockMaterialStock.batch, SapMockMaterialStock.quantity)
    ).all()

    assert {row.source for row in rows} == {"mock_sap"}
    # Satu baris stok SAP = satu supply_record, dan totalnya tidak boleh berbeda dari isi tabel mock.
    assert len(rows) == len(stored)
    assert sum((row.quantity_kg for row in rows), Decimal("0")) == sum(
        (quantity for _batch, quantity in stored), Decimal("0")
    )
    # Angka §11 tetap ikut terbawa (Cianjur 1.400 kg, Jakarta 300 kg).
    assert 1400.0 in {float(row.quantity_kg) for row in rows}
    assert 300.0 in {float(row.quantity_kg) for row in rows}
