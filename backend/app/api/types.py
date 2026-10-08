"""Tipe JSON bersama antar-router.

Angka domain disimpan sebagai `Decimal`; di JSON dikirim sebagai number (bukan string) supaya
frontend tidak perlu parsing khusus. Definisi di satu tempat supaya kontraknya tidak bercabang.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from pydantic import PlainSerializer

Quantity = Annotated[
    Decimal, PlainSerializer(lambda value: float(value), return_type=float, when_used="json")
]
