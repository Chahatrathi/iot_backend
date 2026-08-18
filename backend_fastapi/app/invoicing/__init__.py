# -*- coding: utf-8 -*-
"""Invoicing engine ported from D:\\opencode\\invoices (invoice_tool.py + generators/).

Pure functions (money, tax, state machine, declarations) are reused from the offline
codebase; the JSON-file data layer is replaced with async Postgres access matching the
backend's hand-written-SQL style (see backend_fastapi/README.md).
"""
