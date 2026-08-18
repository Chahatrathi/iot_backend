# -*- coding: utf-8 -*-
"""Invoicing router — Aracharat Ventures LLP PO / invoice / CN / DN web module.

Every route is gated to SUPER_ADMIN only (Akash's role). Mirrors the offline CLI
(invoice_tool.py) as a REST API over the invoice_* Postgres tables, and serves the
generated .docx documents straight to the browser (the React app renders the matching
PDF client-side with pdfmake).
"""
import os
import tempfile
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_db
from app.security import require_roles
from app.invoicing import documents as docs
from app.invoicing import lib

router = APIRouter(prefix="/api/invoices", tags=["Invoicing"])


# ---------------------------------------------------------------- request schemas

class ItemSchema(BaseModel):
    description: str
    specs: Optional[str] = None
    hsn: Optional[str] = None
    qty: float = 1
    uqc: str = "Nos"
    rate: float = 0


class MilestoneSchema(BaseModel):
    label: str
    percent: float = 0
    trigger: str = ""


class OrderCreateSchema(BaseModel):
    buyer: str
    account: str = "hardware"
    goods: bool = True
    items: list[ItemSchema]
    milestones: list[MilestoneSchema] = []
    freight: float = 0
    freight_in_rate: bool = False
    discount: float = 0
    shipping_address: Optional[list[str]] = None
    shipping_state_code: Optional[str] = None
    place_of_supply: Optional[str] = None
    payment_terms: Optional[str] = None
    delivery_terms: Optional[str] = None
    validity: Optional[str] = None
    remarks: Optional[str] = None
    gst_collectable: Optional[bool] = None


class PaymentSchema(BaseModel):
    amount: float
    date: Optional[str] = None
    mode: str = "Bank Transfer"
    remark: str = ""


class FinalSchema(BaseModel):
    date: Optional[str] = None


class RevisedSchema(BaseModel):
    date: Optional[str] = None
    orig: Optional[str] = None


class CnDnSchema(BaseModel):
    amount: float
    date: Optional[str] = None
    ref: str = ""
    reason: str = ""


class BuyerCreateSchema(BaseModel):
    name: str
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    state_code: Optional[str] = None
    pincode: Optional[str] = None
    gstin: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None


# ---------------------------------------------------------------- helpers

def _as_dict(payload):
    """Pydantic payload -> plain order-dict (JSON-safe for storage)."""
    return payload.model_dump(exclude_none=True)


def _temp_dir():
    return tempfile.mkdtemp(prefix="invoice_docs_")


def _public_path(po_no: str, doc_no: str) -> str:
    return f"/api/invoices/orders/{po_no}/documents/{doc_no}"


def _docx_filename(doc_no: str) -> str:
    return doc_no.replace("/", "_") + ".docx"


# ---------------------------------------------------------------- register / report / master

@router.get("/register")
async def get_register(db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles("SUPER_ADMIN"))):
    reg = await lib.load_register(db)
    return {"success": True, **reg}


@router.get("/report")
async def get_report(db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles("SUPER_ADMIN"))):
    orders = await lib.list_orders(db)
    rows = [lib.order_summary(o) for o in orders]
    total_outstanding = round(sum(r["balance_due"] for r in rows), 2)
    return {"success": True, "orders": rows, "total_outstanding": total_outstanding}


@router.get("/buyers")
async def get_buyers(db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles("SUPER_ADMIN"))):
    buyers = await lib.load_buyers(db)
    return {"success": True, "buyers": list(buyers.values())}


@router.post("/buyers", status_code=status.HTTP_201_CREATED)
async def create_buyer(payload: BuyerCreateSchema, db: AsyncSession = Depends(get_db),
                       _: dict = Depends(require_roles("SUPER_ADMIN"))):
    try:
        buyer = await lib.create_buyer(db, payload.model_dump(exclude_none=True))
    except KeyError as e:
        raise HTTPException(status_code=409, detail=str(e))
    await db.commit()
    return {"success": True, "buyer": buyer}


# ---------------------------------------------------------------- orders

@router.get("/orders")
async def list_all_orders(db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles("SUPER_ADMIN"))):
    orders = await lib.list_orders(db)
    return {"success": True, "orders": orders}


# NOTE: po_no / doc_no contain '/' (e.g. AVL-PO/26-27/SH/001), so the params use the
# `:path` converter and the document route is declared before the generic order route —
# Starlette matches in registration order, and the generic {po_no:path} would otherwise
# swallow "/orders/<po>/documents/<doc>".
@router.get("/orders/{po_no:path}/documents/{doc_no:path}")
async def download_document(po_no: str, doc_no: str, db: AsyncSession = Depends(get_db),
                            _: dict = Depends(require_roles("SUPER_ADMIN"))):
    """Rebuild and stream the .docx for a PO ('doc_no' == po_no) or an issued document."""
    try:
        order = await lib.load_order(db, po_no)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    seller = await lib.load_seller(db)
    buyer = await lib.get_buyer(db, order["buyer"])
    out = _temp_dir()

    if doc_no == po_no:
        path = docs.build_po(seller, buyer, order, out)
    else:
        inv = next((i for i in (order.get("invoices") or []) if i.get("no") == doc_no), None)
        if not inv:
            raise HTTPException(status_code=404, detail=f"Document not found on order: {doc_no}")
        kind = inv["kind"]
        payments = [p for p in order.get("payments", []) if p.get("date") <= inv.get("date", "9999")]
        pay = payments[-1] if payments else None
        if kind == "ADVANCE" and pay:
            path = docs.build_advance(seller, buyer, order, inv["no"], inv["date"], pay, out)
        elif kind == "PARTIAL" and pay:
            path = docs.build_partial(seller, buyer, order, inv["no"], inv["date"], pay, out)
        elif kind == "FINAL":
            path = docs.build_final(seller, buyer, order, inv["no"], inv["date"], out)
        elif kind == "CANCELLED":
            path = docs.build_cancelled(seller, buyer, order, inv["no"], inv["date"],
                                        inv.get("remark", ""), out)
        elif kind == "REVISED":
            rmk = inv.get("remark", "")
            orig_no = rmk.split("replacing ")[-1].strip() if "replacing " in rmk else "-"
            orig_date = ""
            if orig_no != "-":
                for pi in order.get("invoices", []):
                    if pi["no"] == orig_no:
                        orig_date = pi.get("date", "")
                        break
            path = docs.build_revised(seller, buyer, order, inv["no"], inv["date"],
                                      orig_no, orig_date, out)
        elif kind in ("CN", "DN"):
            path = docs.build_cn_dn(seller, buyer, order, inv["no"], inv["date"], kind,
                                    inv.get("amount", 0), inv.get("remark", ""),
                                    inv.get("ref", ""), out)
        else:
            raise HTTPException(status_code=404, detail=f"Unsupported document kind: {kind}")

    return FileResponse(path, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        filename=_docx_filename(doc_no))


@router.get("/orders/{po_no:path}")
async def get_order(po_no: str, db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles("SUPER_ADMIN"))):
    try:
        order = await lib.load_order(db, po_no)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    seller = await lib.load_seller(db)
    buyer = await lib.get_buyer(db, order["buyer"])
    return {"success": True, "order": order, "seller": seller, "buyer": buyer}


@router.post("/orders", status_code=status.HTTP_201_CREATED)
async def create_order(
    payload: OrderCreateSchema, db: AsyncSession = Depends(get_db), _: dict = Depends(require_roles("SUPER_ADMIN"))
):
    try:
        await lib.get_buyer(db, payload.buyer)
    except KeyError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not payload.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item")

    order = _as_dict(payload)
    order["po_no"] = await lib.allocate_number(db, "PO", tag=lib.income_tag(order))
    order["po_date"] = str(date.today())
    order["state"] = "CREATED"
    order["advances_received"] = 0.0
    order["cumulative_billed"] = 0.0
    order["payments"] = []
    order["invoices"] = []
    order = lib.recompute(order)

    await lib.save_order(db, order)
    await db.commit()

    seller = await lib.load_seller(db)
    buyer = await lib.get_buyer(db, order["buyer"])
    path = docs.build_po(seller, buyer, order, _temp_dir())
    return {
        "success": True,
        "order": order,
        "document": {
            "kind": "PO",
            "no": order["po_no"],
            "download_url": _public_path(order["po_no"], order["po_no"]),
        },
    }


# ---------------------------------------------------------------- payment state machine

@router.post("/orders/{po_no:path}/advance", status_code=status.HTTP_201_CREATED)
async def issue_advance(po_no: str, payload: PaymentSchema, db: AsyncSession = Depends(get_db),
                        _: dict = Depends(require_roles("SUPER_ADMIN"))):
    return await _issue_payment(po_no, payload, "ADVANCE", db)


@router.post("/orders/{po_no:path}/partial", status_code=status.HTTP_201_CREATED)
async def issue_partial(po_no: str, payload: PaymentSchema, db: AsyncSession = Depends(get_db),
                        _: dict = Depends(require_roles("SUPER_ADMIN"))):
    return await _issue_payment(po_no, payload, "PARTIAL", db)


async def _issue_payment(po_no: str, payload: PaymentSchema, kind: str, db: AsyncSession):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be positive")
    try:
        order = await lib.load_order(db, po_no)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    pay_date = payload.date or str(date.today())
    seller = await lib.load_seller(db)
    buyer = await lib.get_buyer(db, order["buyer"])

    order = lib.record_payment(order, payload.amount, pay_date, payload.mode or "Bank Transfer", payload.remark or "")
    inv_no = await lib.allocate_number(db, "INV", tag=lib.income_tag(order), dt=date.fromisoformat(pay_date))
    order["payments"][-1]["invoice_no"] = inv_no
    order.setdefault("invoices", []).append({
        "kind": kind, "no": inv_no, "date": pay_date, "amount": payload.amount,
        "mode": payload.mode or "", "remark": payload.remark or "",
    })
    order = lib.set_state(order, "ADVANCE-PAID" if kind == "ADVANCE" else "PARTIAL-BILLED")
    await lib.save_order(db, order)
    await db.commit()

    pay = order["payments"][-1]
    if kind == "ADVANCE":
        path = docs.build_advance(seller, buyer, order, inv_no, pay_date, pay, _temp_dir())
    else:
        path = docs.build_partial(seller, buyer, order, inv_no, pay_date, pay, _temp_dir())

    return {
        "success": True,
        "order": order,
        "document": {"kind": kind, "no": inv_no, "date": pay_date,
                     "download_url": _public_path(po_no, inv_no)},
    }


@router.post("/orders/{po_no:path}/final", status_code=status.HTTP_201_CREATED)
async def issue_final(po_no: str, payload: FinalSchema, db: AsyncSession = Depends(get_db),
                      _: dict = Depends(require_roles("SUPER_ADMIN"))):
    try:
        order = await lib.load_order(db, po_no)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if order.get("state") == "SETTLED":
        raise HTTPException(status_code=400, detail="Order already settled")

    inv_date = payload.date or str(date.today())
    seller = await lib.load_seller(db)
    buyer = await lib.get_buyer(db, order["buyer"])
    net = max(0, order["contract_value"] - order.get("cumulative_billed", 0))
    if order.get("goods", True) and order.get("dispatch_on_full_payment", True) and net > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Dispatch BLOCKED: balance outstanding {lib.format_inr(net)}. "
                   f"Goods are dispatched only on complete payment. Record the remaining "
                   f"payment first, or set dispatch_on_full_payment: false to override.",
        )

    inv_no = await lib.allocate_number("INV", tag=lib.income_tag(order), dt=date.fromisoformat(inv_date))
    order.setdefault("invoices", []).append({
        "kind": "FINAL", "no": inv_no, "date": inv_date,
        "amount": order["contract_value"], "remark": "Final dispatch/settlement",
    })
    order = lib.set_state(order, "SHIPPED")
    order["e_way_bill"] = {
        "required": lib.e_way_bill_required(order),
        "generated_by": "buyer" if (not seller.get("gst_registered") and lib.e_way_bill_required(order)) else "supplier",
    }
    if net == 0:
        order = lib.set_state(order, "SETTLED")
    await lib.save_order(db, order)
    await db.commit()

    path = docs.build_final(seller, buyer, order, inv_no, inv_date, _temp_dir())
    return {
        "success": True,
        "order": order,
        "document": {"kind": "FINAL", "no": inv_no, "date": inv_date,
                     "download_url": _public_path(po_no, inv_no),
                     "e_way_bill": order["e_way_bill"]},
    }


@router.post("/orders/{po_no:path}/revised", status_code=status.HTTP_201_CREATED)
async def issue_revised(po_no: str, payload: RevisedSchema, db: AsyncSession = Depends(get_db),
                        _: dict = Depends(require_roles("SUPER_ADMIN"))):
    try:
        order = await lib.load_order(db, po_no)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    rinv_no = await lib.allocate_number("RV", tag=lib.income_tag(order))
    rinv_date = payload.date or str(date.today())
    seller = await lib.load_seller(db)
    buyer = await lib.get_buyer(db, order["buyer"])
    last = [i for i in (order.get("invoices") or []) if i.get("kind") != "CANCELLED"]
    orig_no = payload.orig or (last[-1]["no"] if last else "-")
    orig_date = ""
    if orig_no != "-":
        for i in order.get("invoices", []):
            if i["no"] == orig_no:
                orig_date = i.get("date", "")
                break

    path = docs.build_revised(seller, buyer, order, rinv_no, rinv_date, orig_no, orig_date, _temp_dir())
    order.setdefault("invoices", []).append({
        "kind": "REVISED", "no": rinv_no, "date": rinv_date,
        "amount": order.get("items_value", 0), "remark": f"Revised tax invoice replacing {orig_no}",
    })
    await lib.save_order(db, order)
    await db.commit()
    return {
        "success": True,
        "order": order,
        "document": {"kind": "REVISED", "no": rinv_no, "date": rinv_date,
                     "revises": orig_no, "download_url": _public_path(po_no, rinv_no)},
    }


@router.post("/orders/{po_no:path}/cn", status_code=status.HTTP_201_CREATED)
async def issue_cn(po_no: str, payload: CnDnSchema, db: AsyncSession = Depends(get_db),
                   _: dict = Depends(require_roles("SUPER_ADMIN"))):
    return await _issue_cn_dn(po_no, payload, "CN", db)


@router.post("/orders/{po_no:path}/dn", status_code=status.HTTP_201_CREATED)
async def issue_dn(po_no: str, payload: CnDnSchema, db: AsyncSession = Depends(get_db),
                   _: dict = Depends(require_roles("SUPER_ADMIN"))):
    return await _issue_cn_dn(po_no, payload, "DN", db)


async def _issue_cn_dn(po_no: str, payload: CnDnSchema, kind: str, db: AsyncSession):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be positive")
    try:
        order = await lib.load_order(db, po_no)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    doc_no = await lib.allocate_number("CN" if kind == "CN" else "DN", tag=lib.income_tag(order))
    doc_date = payload.date or str(date.today())
    seller = await lib.load_seller(db)
    buyer = await lib.get_buyer(db, order["buyer"])
    path = docs.build_cn_dn(seller, buyer, order, doc_no, doc_date, kind,
                            payload.amount, payload.reason or "", payload.ref, _temp_dir())
    order.setdefault("invoices", []).append({
        "kind": kind, "no": doc_no, "date": doc_date, "amount": payload.amount,
        "remark": payload.reason or "", "ref": payload.ref or "",
    })
    await lib.save_order(db, order)
    await db.commit()
    return {
        "success": True,
        "order": order,
        "document": {"kind": kind, "no": doc_no, "date": doc_date,
                     "download_url": _public_path(po_no, doc_no)},
    }

