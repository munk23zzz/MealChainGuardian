"""Lapisan HTTP (docs/Architecture.md §4).

Aturan: `api/` memanggil `core/` dan provider SAP — tidak pernah menghitung angka safety-critical
sendiri, dan tidak pernah memanggil SAP langsung.
"""
