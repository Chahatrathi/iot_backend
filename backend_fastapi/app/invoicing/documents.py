# -*- coding: utf-8 -*-
"""Compose each document family: PO, advance, partial, final, credit note, debit note.

Ported from D:\\opencode\\invoices\\generators\\documents.py. Builders are pure: they
take seller/buyer/order dicts (as loaded from the DB by app.invoicing.lib) and write a
.docx into `out_dir` (the web app passes a per-request temp dir — Vercel serverless has
a writable /tmp during the request lifecycle).
"""
import os

from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

from app.invoicing.lib import (amount_in_words, format_inr, compute_tax,
                               gst_declaration, place_of_supply, e_way_bill_required)
from app.invoicing.renderer import (new_document, style_table, set_col_widths, set_cell_bg,
                                    set_cell_margins, build_masthead, build_meta_row,
                                    build_parties, build_ship_to, gap, NAVY_HEX, NAVY, DARK,
                                    GRAY, RED, WHITE, LIGHT_BG, _run, para)

CENTER = WD_ALIGN_PARAGRAPH.CENTER
LEFT = WD_ALIGN_PARAGRAPH.LEFT
RIGHT = WD_ALIGN_PARAGRAPH.RIGHT

ITEMS_COLS = [0.6, 3.67, 0.8, 1.0, 1.0]
ITEMS_HEADERS = ["S.No", "Item & Description", "HSN", "Qty", "Unit Price (₹)", "Amount (₹)"]
SERVICE_COLS = [0.6, 3.27, 0.9, 1.0, 1.0, 1.3]
SERVICE_HEADERS = ["S.No", "Description of Service", "SAC/HSN", "Hours", "₹ / Hour", "Amount (₹)"]


def _hourly(order):
    """Hourly-billed service (e.g. consultation) - items billed as Hours x rate."""
    return order.get("account") == "consultation"


def _po_title(order):
    return "CONSULTATION SERVICE ORDER" if _hourly(order) else "PURCHASE ORDER"


def _inv_title(kind, order):
    if _hourly(order):
        return "CONSULTATION FEE INVOICE"
    return {"ADVANCE": "ADVANCE INVOICE", "PARTIAL": "PARTIAL PAYMENT INVOICE",
            "FINAL": "FINAL INVOICE", "REVISED": "REVISED TAX INVOICE"}.get(kind, "INVOICE")


# ---------------------------------------------------------------- pieces

def _title_badge(seller):
    if not seller.get("gst_registered"):
        return f"GST registration pending · ARN {seller.get('arn', '')}"
    gstin = seller.get("gstin") or ""
    head = f"GSTIN: {gstin}" if gstin else "GST registered"
    if not seller.get("gst_levied", True):
        head += " · No GST collected"
    return head


def _build_items_table(doc, items, hourly=False):
    headers = SERVICE_HEADERS if hourly else ITEMS_HEADERS
    cols = SERVICE_COLS if hourly else ITEMS_COLS
    it = doc.add_table(rows=len(items) + 1, cols=len(headers))
    style_table(it)
    set_col_widths(it, cols)
    for i, h in enumerate(headers):
        cell = it.rows[0].cells[i]
        set_cell_bg(cell, NAVY_HEX)
        set_cell_margins(cell, top=80, bottom=80, left=80, right=80)
        p = cell.paragraphs[0]
        p.alignment = CENTER
        _run(p, h, 8.5, bold=True, color=WHITE)
    for idx, itm in enumerate(items):
        row = it.rows[idx + 1]
        desc = itm.get("description", "")
        if itm.get("specs"):
            desc = desc + "\n" + itm["specs"]
        qty = itm.get("qty", 0)
        uqc = itm.get("uqc", "")
        rate = itm.get("rate", 0)
        if hourly:
            qty_disp = str(qty) + " HRS"
            rate_disp = format_inr(rate) + " / hr"
        else:
            qty_disp = (str(qty) + " " + uqc).strip()
            rate_disp = format_inr(rate)
        vals = [str(idx + 1), desc, itm.get("hsn", "-"),
                qty_disp, rate_disp, format_inr(qty * rate)]
        aligns = [CENTER, LEFT, CENTER, CENTER, RIGHT, RIGHT]
        for i, v in enumerate(vals):
            cell = row.cells[i]
            set_cell_margins(cell, top=60, bottom=60, left=80, right=80)
            p = cell.paragraphs[0]
            p.alignment = aligns[i]
            _run(p, v, 8.5, color=DARK)
    gap(doc)
    return it


def _totals_table(doc, rows):
    """rows: list of (label, value, highlight). highlight -> red bold value."""
    t = doc.add_table(rows=len(rows), cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.RIGHT
    for i, (lbl, val, hl) in enumerate(rows):
        lc, vc = t.rows[i].cells
        lc.width, vc.width = Inches(2.9), Inches(2.3)
        set_cell_margins(lc, top=60, bottom=60, left=120, right=120)
        set_cell_margins(vc, top=60, bottom=60, left=120, right=120)
        if hl:
            set_cell_bg(lc, LIGHT_BG)
            set_cell_bg(vc, LIGHT_BG)
        pl = lc.paragraphs[0]
        _run(pl, lbl, 8, bold=(hl or i == len(rows) - 1), color=DARK)
        pv = vc.paragraphs[0]
        pv.alignment = RIGHT
        _run(pv, val, 8.5, bold=(i == len(rows) - 1), color=(RED if hl else DARK))
    return t


def _payment_tracking(doc, order, payments, last_bold=False):
    """List every payment recorded on the order."""
    t = doc.add_table(rows=len(payments) + 2, cols=4)
    style_table(t)
    widths = [1.0, 1.2, 3.47, 1.4]
    set_col_widths(t, widths)
    hdrs = ["Date", "Mode", "Remark", "Amount (₹)"]
    for i, h in enumerate(hdrs):
        cell = t.rows[0].cells[i]
        set_cell_bg(cell, NAVY_HEX)
        p = cell.paragraphs[0]
        p.alignment = CENTER
        _run(p, h, 8, bold=True, color=WHITE)
    for idx, pay in enumerate(payments):
        vals = [pay.get("date", ""), pay.get("mode", ""), pay.get("remark", ""),
                format_inr(pay.get("amount", 0))]
        aligns = [CENTER, CENTER, LEFT, RIGHT]
        for i, v in enumerate(vals):
            cell = t.rows[idx + 1].cells[i]
            p = cell.paragraphs[0]
            p.alignment = aligns[i]
            _run(p, v, 8, color=DARK)
    cum = t.rows[len(payments) + 1].cells
    set_cell_bg(cum[0], LIGHT_BG)
    set_cell_bg(cum[1], LIGHT_BG)
    set_cell_bg(cum[2], LIGHT_BG)
    set_cell_bg(cum[3], LIGHT_BG)
    _run(cum[0].paragraphs[0], "Cumulative payments received", 8, bold=True, color=DARK)
    _run(cum[3].paragraphs[0], format_inr(order.get("cumulative_billed", 0)), 8.5, bold=True, color=DARK)
    cum[3].paragraphs[0].alignment = RIGHT
    gap(doc)
    return t


def _footer(doc, seller, with_bank=True, note=None):
    ft = doc.add_table(rows=1, cols=2)
    ft.alignment = WD_TABLE_ALIGNMENT.CENTER
    f1, f2 = ft.rows[0].cells
    f1.width, f2.width = Inches(3.8), Inches(3.27)
    style_table(ft)
    set_cell_margins(f1, top=100, bottom=100, left=140, right=140)
    set_cell_margins(f2, top=100, bottom=100, left=140, right=140)
    if with_bank:
        _run(f1.paragraphs[0], "PAYMENT REMITTANCE DETAILS", 7.5, bold=True, color=GRAY)
        bank = seller.get("bank", {})
        lines = [f"Bank Name: {bank.get('bank_name', '')}",
                 f"Account Name: {bank.get('account_name', '')}",
                 f"Account Number: {bank.get('account_number', '') or 'TBD'}",
                 f"IFSC Code: {bank.get('ifsc', '') or 'TBD'}"]
        for ln in lines:
            p = f1.add_paragraph()
            p.paragraph_format.space_after = Pt(0)
            _run(p, ln, 8, color=DARK)
        if bank.get("note"):
            p = f1.add_paragraph()
            p.paragraph_format.space_after = Pt(0)
            _run(p, bank["note"], 7, italic=True, color=RED)
    _run(f2.paragraphs[0], "", 7.5)
    p = f2.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    _run(p, "For Aracharat Ventures LLP", 8.5, bold=True, color=DARK)
    for ln in ["Authorised Signatory", "Designated Partner"]:
        p = f2.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        _run(p, ln, 8, color=GRAY)
    if note:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        _run(p, note, 7, color=GRAY)


def _ship_to(doc, order, buyer):
    ship = order.get("shipping_address") or buyer.get("delivery_address")
    if ship and ship != buyer.get("billing_address"):
        build_ship_to(doc, ship)


def _pos(order, seller, buyer):
    if order.get("place_of_supply"):
        return order["place_of_supply"]
    return place_of_supply(seller, buyer)


def _notes_block(doc, order, title="TERMS & NOTES"):
    notes = []
    if order.get("payment_terms"):
        notes.append(f"Payment terms: {order['payment_terms']}")
    if order.get("delivery_terms"):
        notes.append(f"Delivery: {order['delivery_terms']}")
    if order.get("validity"):
        notes.append(f"Validity: {order['validity']}")
    if order.get("remarks"):
        notes.append(order["remarks"])
    if not notes:
        return
    p = doc.add_paragraph()
    _run(p, title, 8, bold=True, color=GRAY)
    for n in notes:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(1)
        _run(p, n, 8, color=DARK)


def _declaration(doc, text):
    p = doc.add_paragraph()
    _run(p, "STATUTORY TAX DECLARATION", 8, bold=True, color=GRAY)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    _run(p, text, 7.5, color=DARK)


def _totals_rows(order, seller, buyer, extras=None):
    """Standard invoice totals rows; extras appended before net balance."""
    rows = []
    if order.get("items_value") is not None:
        rows.append(("Subtotal", format_inr(order["items_value"]), False))
    if order.get("freight"):
        rows.append(("Freight (included in rate)" if order.get("freight_in_rate") else "Freight",
                     format_inr(order["freight"]), False))
    if order.get("discount"):
        rows.append(("Discount", format_inr(-order["discount"]), False))
    levied = bool(seller.get("gst_registered") and seller.get("gst_levied", True))
    tax_sum = 0.0
    if seller.get("gst_registered"):
        tax_rows = compute_tax(order, seller, buyer)
        tax_sum = sum(amt for _, _, amt, _ in tax_rows)
        for lbl, rate, amt, base in tax_rows:
            suffix = "" if levied else " (no GST collected)"
            rows.append((f"{lbl} @ {rate}%{suffix}", format_inr(amt), False))
    else:
        rows.append(("GST - not levied; registration pending under ARN " + seller.get("arn", ""),
                     format_inr(0.0), False))
    grand = order["contract_value"] + tax_sum
    if levied:
        rows.append(("TOTAL (excl. GST)", format_inr(order["contract_value"]), False))
        rows.append(("GRAND TOTAL (incl. GST)", format_inr(grand), False))
    else:
        rows.append(("TOTAL", format_inr(order["contract_value"]), False))
    if extras:
        rows.extend(extras)
    net = max(0, grand - order.get("cumulative_billed", 0))
    rows.append(("NET BALANCE DUE", format_inr(net), True))
    return rows


# ---------------------------------------------------------------- document builders

def build_po(seller, buyer, order, out_dir, fn=None):
    doc = new_document()
    badge = ("Rev. " + order.get("po_revision")) if order.get("po_revision") else ""
    build_masthead(doc, seller, _po_title(order), badge, show_title=True)
    build_meta_row(doc, [
        ("PO NUMBER", order["po_no"]),
        ("PO DATE", order.get("po_date", "")),
        ("VALIDITY", order.get("validity", "") or "As per contract"),
        ("PAYMENT TERMS", order.get("payment_terms", "Due on receipt")),
    ])
    build_parties(doc, seller, buyer)
    _ship_to(doc, order, buyer)
    _build_items_table(doc, order.get("items", []), hourly=_hourly(order))

    # milestone schedule
    if order.get("milestones"):
        para(doc, "PAYMENT MILESTONES", 8, bold=True, color=GRAY, space_after=2)
        mt = doc.add_table(rows=len(order["milestones"]) + 1, cols=4)
        style_table(mt)
        set_col_widths(mt, [0.6, 3.07, 1.2, 2.2])
        for i, h in enumerate(["S.No", "Milestone", "% of Value", "Trigger / Due"]):
            cell = mt.rows[0].cells[i]
            set_cell_bg(cell, NAVY_HEX)
            _run(cell.paragraphs[0], h, 8, bold=True, color=WHITE)
        for idx, m in enumerate(order["milestones"]):
            vals = [str(idx + 1), m.get("label", ""), str(m.get("percent", "")) + "%",
                    m.get("trigger", "")]
            for i, v in enumerate(vals):
                cell = mt.rows[idx + 1].cells[i]
                p = cell.paragraphs[0]
                p.alignment = CENTER if i in (0, 2) else LEFT
                _run(p, v, 8, color=DARK)
        gap(doc)

    # PO summary (no tax, no remittance)
    st = doc.add_table(rows=1, cols=2)
    st.alignment = WD_TABLE_ALIGNMENT.CENTER
    s1, s2 = st.rows[0].cells
    s1.width, s2.width = Inches(4.0), Inches(3.07)
    _notes_block(s1, order, title="TERMS & CONDITIONS")
    rows = []
    rows.append(("Subtotal", format_inr(order.get("items_value", 0)), False))
    if order.get("freight"):
        rows.append(("Freight", format_inr(order["freight"]), False))
    if order.get("discount"):
        rows.append(("Discount", format_inr(-order["discount"]), False))
    rows.append(("TOTAL PO VALUE", format_inr(order["contract_value"]), False))
    rows.append(("Amount in words", "Indian Rupees " + amount_in_words(order["contract_value"]) + " Only", False))
    _totals_table(s2, rows)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    _run(p, "This Purchase Order is subject to the terms and conditions stated herein and "
            "to the regulations governing the supply. No Goods and Services Tax is levied "
            "until GST registration is complete.", 7.5, color=DARK)
    _footer(doc, seller, with_bank=False)
    return _save(doc, out_dir, fn or f"{order['po_no'].replace('/', '_')}.docx")


def _levying_seller(seller, order):
    """Seller dict whose gst_levied honours a per-order override (e.g. consultation @ 18% GST)."""
    if "gst_levied" in order:
        s = dict(seller)
        s["gst_levied"] = order["gst_levied"]
        return s
    return seller


def build_advance(seller, buyer, order, invoice_no, invoice_date, pay, out_dir):
    seller = _levying_seller(seller, order)
    doc = new_document()
    build_masthead(doc, seller, _inv_title("ADVANCE", order), _title_badge(seller))
    build_meta_row(doc, [
        ("INVOICE NUMBER", invoice_no),
        ("INVOICE DATE", invoice_date),
        ("PLACE OF SUPPLY", _pos(order, seller, buyer)),
        ("PAYMENT TERMS", order.get("payment_terms", "Due on receipt")),
    ])
    build_parties(doc, seller, buyer)
    _ship_to(doc, order, buyer)
    _build_items_table(doc, order.get("items", []), hourly=_hourly(order))
    para(doc, "ADVANCE RECEIPT", 8, bold=True, color=GRAY, space_after=2)
    _payment_tracking(doc, order, order.get("payments", []))

    st = doc.add_table(rows=1, cols=2)
    st.alignment = WD_TABLE_ALIGNMENT.CENTER
    s1, s2 = st.rows[0].cells
    s1.width, s2.width = Inches(4.0), Inches(3.07)
    _notes_block(s1, order)
    rows = _totals_rows(order, seller, buyer, extras=[
        ("Less: Advance received (" + (pay.get("date", "") or "") + ")", format_inr(pay.get("amount", 0)), False),
    ])
    _totals_table(s2, rows)
    _declaration(doc, gst_declaration(seller, buyer))
    _footer(doc, seller, with_bank=True,
            note="Computer-generated document. Subject to " + seller.get("jurisdiction", "") + " jurisdiction.")
    return _save(doc, out_dir, f"{invoice_no.replace('/', '_')}.docx")


def build_partial(seller, buyer, order, invoice_no, invoice_date, pay, out_dir):
    seller = _levying_seller(seller, order)
    doc = new_document()
    build_masthead(doc, seller, _inv_title("PARTIAL", order), _title_badge(seller))
    build_meta_row(doc, [
        ("INVOICE NUMBER", invoice_no),
        ("INVOICE DATE", invoice_date),
        ("PLACE OF SUPPLY", _pos(order, seller, buyer)),
        ("PAYMENT TERMS", order.get("payment_terms", "Due on receipt")),
    ])
    build_parties(doc, seller, buyer)
    _ship_to(doc, order, buyer)
    _build_items_table(doc, order.get("items", []), hourly=_hourly(order))
    para(doc, "PAYMENT TRACKING", 8, bold=True, color=GRAY, space_after=2)
    _payment_tracking(doc, order, order.get("payments", []))

    st = doc.add_table(rows=1, cols=2)
    st.alignment = WD_TABLE_ALIGNMENT.CENTER
    s1, s2 = st.rows[0].cells
    s1.width, s2.width = Inches(4.0), Inches(3.07)
    _notes_block(s1, order)
    rows = _totals_rows(order, seller, buyer)
    _totals_table(s2, rows)
    _declaration(doc, gst_declaration(seller, buyer))
    _footer(doc, seller, with_bank=True,
            note="Computer-generated document. Subject to " + seller.get("jurisdiction", "") + " jurisdiction.")
    return _save(doc, out_dir, f"{invoice_no.replace('/', '_')}.docx")


def build_final(seller, buyer, order, invoice_no, invoice_date, out_dir):
    seller = _levying_seller(seller, order)
    doc = new_document()
    build_masthead(doc, seller, _inv_title("FINAL", order), _title_badge(seller))
    build_meta_row(doc, [
        ("INVOICE NUMBER", invoice_no),
        ("INVOICE DATE", invoice_date),
        ("PLACE OF SUPPLY", _pos(order, seller, buyer)),
        ("PAYMENT TERMS", order.get("payment_terms", "Due on receipt")),
    ])
    build_parties(doc, seller, buyer)
    _ship_to(doc, order, buyer)
    _build_items_table(doc, order.get("items", []), hourly=_hourly(order))
    para(doc, "PAYMENTS RECEIVED AGAINST THIS ORDER", 8, bold=True, color=GRAY, space_after=2)
    _payment_tracking(doc, order, order.get("payments", []))

    st = doc.add_table(rows=1, cols=2)
    st.alignment = WD_TABLE_ALIGNMENT.CENTER
    s1, s2 = st.rows[0].cells
    s1.width, s2.width = Inches(4.0), Inches(3.07)
    _notes_block(s1, order)
    if e_way_bill_required(order):
        if seller.get("gst_registered"):
            p = s1.add_paragraph()
            _run(p, "E-WAY BILL: consignment value exceeds ₹50,000, so an e-way bill is required "
                    "under Rule 138 regardless of mode of transport. As the registered supplier, "
                    "Aracharat Ventures LLP should generate it.", 7, color=RED)
        else:
            p = s1.add_paragraph()
            _run(p, "E-WAY BILL: consignment value exceeds ₹50,000, so an e-way bill is required "
                    "under Rule 138 regardless of mode of transport. As the registered recipient, "
                    "the buyer is the deemed cause of movement and should generate it.", 7, color=RED)

    extras = []
    for pay in order.get("payments", []):
        extras.append(("Less: Advance received " + (pay.get("date", "") or "") + " (" + (pay.get("mode", "") or "") + ")",
                       format_inr(pay.get("amount", 0)), False))
    rows = _totals_rows(order, seller, buyer, extras=extras)
    _totals_table(s2, rows)
    _declaration(doc, gst_declaration(seller, buyer))
    _footer(doc, seller, with_bank=True,
            note="Computer-generated document. Subject to " + seller.get("jurisdiction", "") + " jurisdiction.")
    return _save(doc, out_dir, f"{invoice_no.replace('/', '_')}.docx")


def build_revised(seller, buyer, order, rinv_no, rinv_date, orig_no, orig_date, out_dir):
    """Revised Tax Invoice (s.31(3)(a) CGST / Rule 53) — levies the GST that the
    original commercial invoice did not, referencing the original invoice.
    Respects the per-order `gst_collectable` flag (default True); when False the
    revised invoice is issued with zero GST."""
    levy = order.get("gst_collectable", True)
    levying = dict(seller)
    levying["gst_levied"] = levy
    doc = new_document()
    build_masthead(doc, levying, "REVISED TAX INVOICE", _title_badge(levying))
    build_meta_row(doc, [
        ("REVISED INVOICE NUMBER", rinv_no),
        ("REVISED DATE", rinv_date),
        ("PLACE OF SUPPLY", _pos(order, seller, buyer)),
        ("PAYMENT TERMS", order.get("payment_terms", "Due on receipt")),
    ])
    build_parties(doc, levying, buyer)
    _ship_to(doc, order, buyer)

    rt = doc.add_table(rows=1, cols=2)
    style_table(rt)
    set_col_widths(rt, [3.5, 3.57])
    set_cell_bg(rt.rows[0].cells[0], LIGHT_BG)
    set_cell_bg(rt.rows[0].cells[1], LIGHT_BG)
    _run(rt.rows[0].cells[0].paragraphs[0], "REVISION OF ORIGINAL INVOICE", 7.5, bold=True, color=GRAY)
    _run(rt.rows[0].cells[1].paragraphs[0],
         f"No: {orig_no or '-'}   |   Dated: {orig_date or '-'}", 8.5, bold=True, color=DARK)
    gap(doc)

    _build_items_table(doc, order.get("items", []), hourly=_hourly(order))
    taxable = order.get("items_value", 0)
    received = order.get("cumulative_billed", 0)
    tax_rows = compute_tax(order, levying, buyer)
    grand = round(taxable + sum(amt for _, _, amt, _ in tax_rows), 2)
    net = round(grand - received, 2)

    st = doc.add_table(rows=1, cols=2)
    st.alignment = WD_TABLE_ALIGNMENT.CENTER
    s1, s2 = st.rows[0].cells
    s1.width, s2.width = Inches(4.0), Inches(3.07)
    _notes_block(s1, order)
    p = s1.add_paragraph()
    _run(p, "This is a Revised Tax Invoice issued under Section 31(3)(a) of the CGST Act, 2017 "
            "read with Rule 53(2), revising original invoice " + (orig_no or "-") + " dated "
            + (orig_date or "-") + ". The GST shown is now collectable in addition to the amount "
            "already received against the original invoice.", 7, color=DARK)

    rows = [("Subtotal", format_inr(taxable), False)]
    for lbl, rate, amt, _ in tax_rows:
        rows.append((f"{lbl} @ {rate}%", format_inr(amt), False))
    rows.append(("TOTAL (incl. GST)", format_inr(grand), False))
    rows.append(("Less: Already received against original invoice", format_inr(received), False))
    rows.append(("NET BALANCE DUE (incl. GST)", format_inr(net), True))
    _totals_table(s2, rows)

    _declaration(doc, gst_declaration(levying, buyer))
    _footer(doc, seller, with_bank=True,
            note="Computer-generated document. Subject to " + seller.get("jurisdiction", "") + " jurisdiction.")
    return _save(doc, out_dir, f"{rinv_no.replace('/', '_')}.docx")


def build_cancelled(seller, buyer, order, doc_no, doc_date, remark, out_dir):
    """Voided invoice stub - keeps the serial series gapless."""
    doc = new_document()
    build_masthead(doc, seller, "CANCELLED INVOICE", _title_badge(seller))
    build_meta_row(doc, [
        ("INVOICE NUMBER", doc_no),
        ("INVOICE DATE", doc_date),
        ("STATUS", "CANCELLED / VOID"),
        ("PAYMENT TERMS", order.get("payment_terms", "Due on receipt")),
    ])
    build_parties(doc, seller, buyer)
    _ship_to(doc, order, buyer)
    p = doc.add_paragraph()
    p.alignment = CENTER
    _run(p, "THIS INVOICE HAS BEEN CANCELLED AND IS NOT VALID FOR ANY TAX OR PAYMENT PURPOSE.", 12,
         bold=True, color=RED)
    p = doc.add_paragraph()
    _run(p, remark or "Cancelled.", 9, color=DARK)
    _declaration(doc, gst_declaration(seller, buyer))
    _footer(doc, seller, with_bank=False)
    return _save(doc, out_dir, f"{doc_no.replace('/', '_')}.docx")


def build_cn_dn(seller, buyer, order, doc_no, doc_date, kind, amount, reason, ref_no, out_dir):
    title = "CREDIT NOTE" if kind == "CN" else "DEBIT NOTE"
    doc = new_document()
    build_masthead(doc, seller, title, _title_badge(seller))
    build_meta_row(doc, [
        ("DOCUMENT NUMBER", doc_no),
        ("DOCUMENT DATE", doc_date),
        ("REFERENCE INVOICE", ref_no or "-"),
        ("PAYMENT TERMS", order.get("payment_terms", "Due on receipt")),
    ])
    build_parties(doc, seller, buyer)
    _ship_to(doc, order, buyer)
    t = doc.add_table(rows=2, cols=3)
    style_table(t)
    set_col_widths(t, [4.0, 1.5, 1.57])
    hdrs = ["Reason / Description", "Ref. PO", "Amount (₹)"]
    for i, h in enumerate(hdrs):
        cell = t.rows[0].cells[i]
        set_cell_bg(cell, NAVY_HEX)
        _run(cell.paragraphs[0], h.upper(), 8, bold=True, color=WHITE)
    vals = [reason, order.get("po_no", ""), format_inr(amount)]
    for i, v in enumerate(vals):
        cell = t.rows[1].cells[i]
        p = cell.paragraphs[0]
        p.alignment = RIGHT if i == 2 else LEFT
        _run(p, v, 8.5, color=DARK)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    _declaration(doc, gst_declaration(seller, buyer))
    _footer(doc, seller, with_bank=False)
    return _save(doc, out_dir, f"{doc_no.replace('/', '_')}.docx")


def _save(doc, out_dir, fn):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, fn)
    doc.save(path)
    return path
