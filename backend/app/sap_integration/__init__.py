"""Adapter SAP (anti-corruption layer) — lihat docs/Architecture.md §9.2 dan provider_interface.py.

Aturan: core/, api/, dan agent/ tidak pernah memanggil SAP langsung, selalu lewat paket ini.
"""
