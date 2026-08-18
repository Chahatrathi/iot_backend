# -*- coding: utf-8 -*-
"""python-docx layout primitives shared by all generated documents.

Ported verbatim from D:\\opencode\\invoices\\generators\\renderer.py. Reproduces the
styling of the working 'Commercial Invoice Template - GST Pending.docx'
(A4, 0.6in margins, navy/slate palette, 6-block layout).
"""
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls

NAVY = RGBColor(0x1A, 0x36, 0x5D)
DARK = RGBColor(0x0F, 0x17, 0x2A)
GRAY = RGBColor(0x64, 0x74, 0x8B)
RED = RGBColor(0xDC, 0x26, 0x26)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT_BG = "F8FAFC"
NAVY_HEX = "1A365D"
RED_HEX = "DC2626"

FONT = "Calibri"


def _gst_status_line(seller):
    if not seller.get("gst_registered"):
        return f"GST Status: Registration in progress (ARN: {seller.get('arn', '')})"
    gstin = seller.get("gstin") or ""
    line = f"GSTIN: {gstin}" if gstin else "GST Status: Registered"
    if not seller.get("gst_levied", True):
        line += "  ·  No GST collected"
    return line


def set_cell_bg(cell, fill_hex):
    tcPr = cell._element.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:val="clear" w:fill="{fill_hex}"/>')
    tcPr.append(shd)


def set_cell_margins(cell, top=80, bottom=80, left=140, right=140):
    tcPr = cell._element.get_or_add_tcPr()
    tcMar = parse_xml(
        f'<w:tcMar {nsdecls("w")}><w:top w:w="{top}" w:type="dxa"/>'
        f'<w:bottom w:w="{bottom}" w:type="dxa"/><w:left w:w="{left}" w:type="dxa"/>'
        f'<w:right w:w="{right}" w:type="dxa"/></w:tcMar>'
    )
    tcPr.append(tcMar)


def set_col_widths(table, widths_in):
    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            if idx < len(widths_in):
                cell.width = Inches(widths_in[idx])


def _run(p, text, size, bold=False, color=DARK, italic=False, space_after=None):
    r = p.add_run(text)
    r.font.name = FONT
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.italic = italic
    if color is not None:
        r.font.color.rgb = color
    return r


def para(doc, text, size=10, bold=False, color=DARK, align=None, space_after=None, space_before=None):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    if space_after is not None:
        p.paragraph_format.space_after = Pt(space_after)
    if space_before is not None:
        p.paragraph_format.space_before = Pt(space_before)
    _run(p, text, size, bold=bold, color=color)
    return p


def gap(doc, pts=2):
    """Compact spacer paragraph - breathing room without a full-height empty line."""
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(pts)
    p.paragraph_format.line_spacing = Pt(4)
    r = p.add_run("")
    r.font.size = Pt(2)
    return p


def new_document():
    doc = Document()
    # Compact global layout: single line spacing, zero default space-after/before.
    normal = doc.styles["Normal"]
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(0)
    normal.paragraph_format.line_spacing = 1.0
    for section in doc.sections:
        section.page_width, section.page_height = Inches(8.27), Inches(11.69)
        section.top_margin = section.bottom_margin = Inches(0.5)
        section.left_margin = section.right_margin = Inches(0.6)
        section.footer_distance = Inches(0.3)
    return doc


def style_table(table, borders=True):
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    if not borders:
        table.autofit = False
    tblPr = table._tbl.tblPr
    borders_el = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        '<w:top w:val="single" w:sz="4" w:color="D9DEE7"/>'
        '<w:left w:val="single" w:sz="4" w:color="D9DEE7"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="D9DEE7"/>'
        '<w:right w:val="single" w:sz="4" w:color="D9DEE7"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="D9DEE7"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="D9DEE7"/>'
        '</w:tblBorders>'
    )
    tblPr.append(borders_el)


def cell_text(cell, text, size=9, bold=False, color=DARK, align=None):
    p = cell.paragraphs[0]
    if align is not None:
        p.alignment = align
    _run(p, text, size, bold=bold, color=color)
    return p


def label_value(cell, label, value, label_size=7.5, value_size=9.5):
    """Two stacked paragraphs: small gray caps label over bold value."""
    set_cell_margins(cell, top=90, bottom=90, left=120, right=120)
    p = cell.paragraphs[0]
    _run(p, label.upper(), label_size, bold=True, color=GRAY)
    p2 = cell.add_paragraph()
    _run(p2, value, value_size, bold=True, color=DARK)
    return p2


# ---------------------------------------------------------------- masthead

def build_masthead(doc, seller, doc_title, badge, show_title=True):
    ht = doc.add_table(rows=1, cols=2)
    ht.alignment = WD_TABLE_ALIGNMENT.CENTER
    cl, cr = ht.rows[0].cells
    cl.width, cr.width = Inches(4.5), Inches(2.57)
    style_table(ht)

    p = cl.paragraphs[0]
    _run(p, seller["name"].upper() + "\n", 16, bold=True, color=NAVY)
    _run(p, f"{seller['entity_type']}  ·  LLPIN: {seller['llpin']}  ·  PAN: {seller['pan']}\n",
         8.5, color=DARK)
    _run(p, seller["registered_office"] + "\n", 8.5, color=DARK)
    _run(p, f"Email: {seller['email']}  |  Phone: {seller['phone']}", 8.5, color=DARK)

    pr = cr.paragraphs[0]
    pr.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    if show_title:
        _run(pr, doc_title + "\n", 15, bold=True, color=NAVY)
        _run(pr, badge, 8, color=GRAY)
    gap(doc)
    return ht


def build_meta_row(doc, cells):
    """cells: list of (label, value) tuples, 2 or 4 entries."""
    mt = doc.add_table(rows=1, cols=len(cells))
    mt.alignment = WD_TABLE_ALIGNMENT.CENTER
    widths = Inches(1.76) if len(cells) == 4 else Inches(3.54)
    for i, (lbl, val) in enumerate(cells):
        c = mt.rows[0].cells[i]
        c.width = widths
        set_cell_bg(c, LIGHT_BG)
        label_value(c, lbl, val)
    gap(doc)
    return mt


def build_parties(doc, seller, buyer, seller_extra=None, buyer_extra=None):
    """seller_extra / buyer_extra: extra line(s) added to each block."""
    pt = doc.add_table(rows=1, cols=2)
    pt.alignment = WD_TABLE_ALIGNMENT.CENTER
    c1, c2 = pt.rows[0].cells
    c1.width, c2.width = Inches(3.54), Inches(3.54)
    style_table(pt)

    def fill(cell, title, lines):
        set_cell_bg(cell, LIGHT_BG)
        set_cell_margins(cell, top=100, bottom=100, left=140, right=140)
        _run(cell.paragraphs[0], title.upper(), 7.5, bold=True, color=GRAY)
        for i, ln in enumerate(lines):
            p = cell.add_paragraph()
            p.paragraph_format.space_after = Pt(0)
            _run(p, ln, 8.5, bold=(i == 0), color=DARK)

    seller_lines = [seller["name"], seller["registered_office"],
                    f"LLPIN: {seller['llpin']}  |  PAN: {seller['pan']}",
                    _gst_status_line(seller),
                    f"Email: {seller['email']}  |  Phone: {seller['phone']}"]
    buyer_lines = [buyer["name"], buyer["billing_address"],
                   f"GSTIN: {buyer.get('gstin', '')}",
                   f"Contact: {buyer.get('contact_name', '')} - {buyer.get('contact_email', '')}",
                   f"Phone: {buyer.get('contact_phone', '')}"]

    fill(c1, "Issued by", seller_lines + (seller_extra or []))
    fill(c2, "Billed to", buyer_lines + (buyer_extra or []))
    gap(doc)
    return pt


def build_ship_to(doc, address):
    """Optional full-width SHIP TO block, rendered only when a shipping address exists."""
    if not address:
        return None
    lines = address if isinstance(address, (list, tuple)) else [line for line in str(address).splitlines() if line.strip()]
    lines = [ln.strip() for ln in lines if ln.strip()]
    if not lines:
        return None
    st = doc.add_table(rows=1, cols=1)
    st.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = st.rows[0].cells[0]
    cell.width = Inches(7.07)
    set_cell_bg(cell, LIGHT_BG)
    set_cell_margins(cell, top=80, bottom=80, left=140, right=140)
    _run(cell.paragraphs[0], "SHIP TO", 7.5, bold=True, color=GRAY)
    for i, ln in enumerate(lines):
        p = cell.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        _run(p, ln, 8.5, bold=(i == 0), color=DARK)
    gap(doc)
    return st
