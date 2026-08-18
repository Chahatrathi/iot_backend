# -*- coding: utf-8 -*-
"""Core invoicing engine: master data, registers/numbering, money, state machine, ledger.

Ported from D:\\opencode\\invoices\\generators\\invoice_lib.py. The pure helpers
(amount_in_words, format_inr, compute_tax, gst_declaration, e_way_bill_required, state
machine) are verbatim; every file-backed read/write is replaced by an async function
that talks to the invoice_* Postgres tables via SQLAlchemy text().
"""
import json
import re
from datetime import date, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Income-type tags embedded in document numbers (after the FY segment), e.g.
# AVL-PO/26-27/SH/001 and AVL/26-27/FER/001. Short codes keep invoice serials
# within the 16-character cap.
INCOME_TAGS = {
    "sensors_hardware": "SH",
    "sensors_software": "SS",
    "consulting": "CON",
    "fertiliser": "FER",
}

# Order "account" field -> income-type tag code.
ACCOUNT_TAG = {
    "hardware": "SH",
    "software": "SS",
    "consultation": "CON",
    "fertilizer": "FER",
    "freight": "SH",  # sensor hardware freight groups under the sensors stream
}

SERIES_PREFIX = {
    "PO": "AVL-PO",
    "INV": "AVL",
    "CN": "AVL-CN",
    "DN": "AVL-DN",
    "RV": "AVL-RV",
    "CMB": "AVL-CMB",
}

KINDS = ("PO", "INV", "CN", "DN", "RV", "CMB")

VALID_STATES = ("CREATED", "ADVANCE-PAID", "PARTIAL-BILLED", "SHIPPED", "SETTLED")

INVOICE_COLUMNS = (
    "po_no, po_date, buyer, account, goods, state, items, milestones, payments, "
    "invoices, freight, freight_in_rate, discount, items_value, contract_value, "
    "advances_received, cumulative_billed, shipping_address, shipping_state_code, "
    "place_of_supply, payment_terms, delivery_terms, validity, remarks, e_way_bill, "
    "gst_collectable"
)


def income_tag(order):
    """Income-type tag code for a document of this order, or '' if unknown."""
    return ACCOUNT_TAG.get((order or {}).get("account"), "")


# ---------------------------------------------------------------- numbering

def current_fy(dt=None):
    dt = dt or date.today()
    y = dt.year
    fy_start = y if dt.month >= 4 else y - 1
    return f"{fy_start % 100:02d}-{(fy_start + 1) % 100:02d}"


async def load_register(db: AsyncSession) -> dict:
    """Build the register structure {"fy": ..., "series": {kind: {tag: {"last_seq": n}}}}."""
    fy = current_fy()
    rows = (await db.execute(
        text("SELECT kind, tag, last_seq FROM invoice_register WHERE fy = :fy;"), {"fy": fy}
    )).mappings().all()
    series = {k: {} for k in KINDS}
    for row in rows:
        series[row["kind"]][row["tag"] or ""] = {"last_seq": int(row["last_seq"])}
    return {"fy": fy, "series": series}


async def allocate_number(db: AsyncSession, kind: str, tag: str = "", dt=None) -> str:
    """Atomically allocate the next serial for a document family.

    Each (kind, income-tag) pair runs its own consecutive series, e.g.
    PO -> AVL-PO/26-27/SH/001, INV -> AVL/26-27/FER/001. The single
    INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING statement bumps the counter
    under the row lock, so serials never gap even under concurrency.
    """
    if kind not in KINDS:
        raise ValueError(f"Unknown kind '{kind}'")
    fy = current_fy(dt)
    key = (tag or "").strip().upper()
    row = (await db.execute(
        text("""
            INSERT INTO invoice_register (fy, kind, tag, last_seq)
            VALUES (:fy, :kind, :tag, 1)
            ON CONFLICT (fy, kind, tag) DO UPDATE
            SET last_seq = invoice_register.last_seq + 1
            RETURNING last_seq;
        """),
        {"fy": fy, "kind": kind, "tag": key},
    )).scalar()
    seq = int(row)
    if key:
        return f"{SERIES_PREFIX[kind]}/{fy}/{key}/{seq:03d}"
    return f"{SERIES_PREFIX[kind]}/{fy}/{seq:03d}"


# ---------------------------------------------------------------- money

ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
        "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
        "Seventeen", "Eighteen", "Nineteen"]
TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two(n):
    if n < 20:
        return ONES[n]
    return TENS[n // 10] + ((" " + ONES[n % 10]) if n % 10 else "")


def _three(n):
    h, rem = divmod(n, 100)
    s = ""
    if h:
        s += ONES[h] + " Hundred"
    if rem:
        s += (s and " " or "") + _two(rem)
    return s


def amount_in_words(num):
    """Indian numbering: lakhs and crores."""
    num = max(0, round(num, 2))
    rupees = int(num)
    paise = int(round((num - rupees) * 100))
    if rupees == 0 and paise == 0:
        return "Zero"
    crore, rem = divmod(rupees, 10000000)
    lakh, rem = divmod(rem, 100000)
    thousand, rem = divmod(rem, 1000)
    parts = []
    if crore:
        parts.append(_three(crore) + " Crore")
    if lakh:
        parts.append(_two(lakh) + " Lakh")
    if thousand:
        parts.append(_two(thousand) + " Thousand")
    if rem:
        parts.append(_three(rem))
    text = " ".join(parts)
    if paise:
        text += ((" and " if text else "") + _two(paise) + " Paise")
    return text


def format_inr(amount):
    """Indian-grouped currency, e.g. ₹1,23,456.78"""
    amount = round(float(amount), 2)
    sign = "-" if amount < 0 else ""
    a = abs(amount)
    rupees = int(a)
    paise = int(round((a - rupees) * 100))
    r = str(rupees)
    if len(r) > 3:
        last3 = r[-3:]
        rest = r[:-3]
        rest = re.sub(r"\B(?=(\d{2})+(?!\d))", ",", rest)
        r = rest + "," + last3
    return f"{sign}₹{r}.{paise:02d}"


def parse_amount(s):
    return float(re.sub(r"[^0-9.]", "", str(s)))


# ---------------------------------------------------------------- orders / ledger

def _row_to_order(row) -> dict:
    order = {
        "po_no": row["po_no"],
        "po_date": row["po_date"],
        "buyer": row["buyer"],
        "account": row["account"],
        "goods": row["goods"],
        "state": row["state"],
        "items": row["items"] or [],
        "milestones": row["milestones"] or [],
        "payments": row["payments"] or [],
        "invoices": row["invoices"] or [],
        "freight": float(row["freight"] or 0),
        "freight_in_rate": row["freight_in_rate"],
        "discount": float(row["discount"] or 0),
        "items_value": float(row["items_value"] or 0),
        "contract_value": float(row["contract_value"] or 0),
        "advances_received": float(row["advances_received"] or 0),
        "cumulative_billed": float(row["cumulative_billed"] or 0),
        "shipping_address": row["shipping_address"],
        "shipping_state_code": row["shipping_state_code"],
        "place_of_supply": row["place_of_supply"],
        "payment_terms": row["payment_terms"],
        "delivery_terms": row["delivery_terms"],
        "validity": row["validity"],
        "remarks": row["remarks"],
        "e_way_bill": row["e_way_bill"],
    }
    if row["gst_collectable"] is not None:
        order["gst_collectable"] = row["gst_collectable"]
    return order


async def load_order(db: AsyncSession, po_no: str) -> dict:
    row = (await db.execute(
        text(f"SELECT {INVOICE_COLUMNS} FROM invoice_orders WHERE po_no = :po;"), {"po": po_no}
    )).mappings().first()
    if not row:
        raise KeyError(f"Order not found: {po_no}")
    return _row_to_order(row)


async def list_orders(db: AsyncSession) -> list:
    rows = (await db.execute(
        text(f"""
            SELECT {INVOICE_COLUMNS} FROM invoice_orders
            ORDER BY po_date, po_no;
        """)
    )).mappings().all()
    return [_row_to_order(r) for r in rows]


async def save_order(db: AsyncSession, order: dict):
    await db.execute(
        text(f"""
            INSERT INTO invoice_orders ({INVOICE_COLUMNS}, updated_at)
            VALUES (:po_no, :po_date, :buyer, :account, :goods, :state, :items, :milestones,
                    :payments, :invoices, :freight, :freight_in_rate, :discount, :items_value,
                    :contract_value, :advances_received, :cumulative_billed, :shipping_address,
                    :shipping_state_code, :place_of_supply, :payment_terms, :delivery_terms,
                    :validity, :remarks, :e_way_bill, :gst_collectable, NOW())
            ON CONFLICT (po_no) DO UPDATE SET
                po_date = EXCLUDED.po_date,
                buyer = EXCLUDED.buyer,
                account = EXCLUDED.account,
                goods = EXCLUDED.goods,
                state = EXCLUDED.state,
                items = EXCLUDED.items,
                milestones = EXCLUDED.milestones,
                payments = EXCLUDED.payments,
                invoices = EXCLUDED.invoices,
                freight = EXCLUDED.freight,
                freight_in_rate = EXCLUDED.freight_in_rate,
                discount = EXCLUDED.discount,
                items_value = EXCLUDED.items_value,
                contract_value = EXCLUDED.contract_value,
                advances_received = EXCLUDED.advances_received,
                cumulative_billed = EXCLUDED.cumulative_billed,
                shipping_address = EXCLUDED.shipping_address,
                shipping_state_code = EXCLUDED.shipping_state_code,
                place_of_supply = EXCLUDED.place_of_supply,
                payment_terms = EXCLUDED.payment_terms,
                delivery_terms = EXCLUDED.delivery_terms,
                validity = EXCLUDED.validity,
                remarks = EXCLUDED.remarks,
                e_way_bill = EXCLUDED.e_way_bill,
                gst_collectable = EXCLUDED.gst_collectable,
                updated_at = NOW();
        """),
        {
            "po_no": order["po_no"],
            "po_date": order.get("po_date"),
            "buyer": order.get("buyer"),
            "account": order.get("account", "hardware"),
            "goods": bool(order.get("goods", True)),
            "state": order.get("state", "CREATED"),
            "items": json.dumps(order.get("items", []), ensure_ascii=False),
            "milestones": json.dumps(order.get("milestones", []), ensure_ascii=False),
            "payments": json.dumps(order.get("payments", []), ensure_ascii=False),
            "invoices": json.dumps(order.get("invoices", []), ensure_ascii=False),
            "freight": order.get("freight", 0),
            "freight_in_rate": bool(order.get("freight_in_rate", False)),
            "discount": order.get("discount", 0),
            "items_value": order.get("items_value", 0),
            "contract_value": order.get("contract_value", 0),
            "advances_received": order.get("advances_received", 0),
            "cumulative_billed": order.get("cumulative_billed", 0),
            "shipping_address": json.dumps(order["shipping_address"], ensure_ascii=False) if order.get("shipping_address") else None,
            "shipping_state_code": order.get("shipping_state_code"),
            "place_of_supply": order.get("place_of_supply"),
            "payment_terms": order.get("payment_terms"),
            "delivery_terms": order.get("delivery_terms"),
            "validity": order.get("validity"),
            "remarks": order.get("remarks"),
            "e_way_bill": json.dumps(order["e_way_bill"], ensure_ascii=False) if order.get("e_way_bill") else None,
            "gst_collectable": order.get("gst_collectable"),
        },
    )


def order_summary(order):
    return {
        "po_no": order["po_no"],
        "po_date": order.get("po_date"),
        "buyer": order.get("buyer"),
        "account": order.get("account"),
        "state": order.get("state"),
        "contract_value": order.get("contract_value", 0),
        "advances_received": order.get("advances_received", 0),
        "cumulative_billed": order.get("cumulative_billed", 0),
        "balance_due": max(0, order.get("contract_value", 0) - order.get("cumulative_billed", 0) + order.get("freight", 0) - order.get("discount", 0)),
    }


def recompute(order):
    """Recalculate contract value / freight / discount from items + fields."""
    total = sum((i.get("qty", 0) * i.get("rate", 0) for i in order.get("items", [])))
    order["items_value"] = round(total, 2)
    order["contract_value"] = round(total + order.get("freight", 0) - order.get("discount", 0), 2)
    return order


def record_payment(order, amount, pay_date, mode, remark):
    """Append a payment to the order ledger and update cumulative billed."""
    payments = order.setdefault("payments", [])
    payments.append({
        "date": str(pay_date),
        "amount": round(amount, 2),
        "mode": mode,
        "remark": remark,
        "invoice_no": None,  # filled in by the caller once a serial is allocated
    })
    order["advances_received"] = round(order.get("advances_received", 0) + amount, 2)
    order["cumulative_billed"] = round(order.get("cumulative_billed", 0) + amount, 2)
    return order


def set_state(order, state):
    if state not in VALID_STATES:
        raise ValueError(f"Invalid state '{state}'")
    order["state"] = state
    return order


def compute_tax(order, seller, buyer):
    """Return list of (label, statutory_rate%, tax_amount, taxable_base).

    Head follows the place of supply (shipping destination for goods): intra-State
    -> CGST+SGST, inter-State -> IGST. Amount is zero when GST is not levied.
    """
    taxable = order.get("items_value", 0)
    if not seller.get("gst_registered"):
        return []
    rates = seller.get("gst_rates", {})
    levied = seller.get("gst_levied", True)
    supply_code = order.get("shipping_state_code") or buyer.get("state_code")
    if seller.get("state_code") == supply_code:
        cgst = rates.get("cgst", 0)
        sgst = rates.get("sgst", 0)
        return [("CGST", cgst, round(taxable * cgst / 100.0, 2) if levied else 0.0, taxable),
                ("SGST", sgst, round(taxable * sgst / 100.0, 2) if levied else 0.0, taxable)]
    igst = rates.get("igst", 0)
    return [("IGST", igst, round(taxable * igst / 100.0, 2) if levied else 0.0, taxable)]


def place_of_supply(seller, buyer):
    return f"{buyer.get('state')} ({buyer.get('state_code')})"


def is_intra_state(seller, buyer):
    return seller.get("state_code") == buyer.get("state_code")


def e_way_bill_required(order):
    """Rule 138: goods consignment value > ₹50,000 triggers an e-way bill."""
    return (order.get("goods", True) and bool(order.get("items"))
            and order.get("contract_value", 0) > 50000)


# ---------------------------------------------------------------- compliance text

def gst_declaration(seller, buyer):
    if seller.get("gst_registered"):
        if seller.get("gst_levied", True):
            return ("Tax Invoice issued under the CGST Act, 2017. Reverse charge is "
                    "applicable: No. Place of supply: %s." % buyer.get("state"))
        return ("This invoice states the applicable tax head (IGST or CGST + SGST) as "
                "per the place of supply, but no Goods and Services Tax (GST) has been "
                "collected on this supply. Reverse charge applicable: No.")
    arn = seller.get("arn", "")
    return ("This document is a Commercial Invoice issued prior to GSTIN allotment. "
            "GST registration is currently under processing with Application Reference "
            f"Number (ARN): {arn}. No Goods and Services Tax (GST) has been levied on "
            "this bill. A Revised Tax Invoice will be issued upon receipt of the final "
            "GST Registration Certificate, as per applicable statutory rules under "
            "Section 31(3)(a) of the CGST Act, 2017.")


# ---------------------------------------------------------------- master data

async def load_seller(db: AsyncSession) -> dict:
    row = (await db.execute(
        text("SELECT * FROM invoice_seller WHERE id = 1;")
    )).mappings().first()
    if not row:
        raise RuntimeError("invoice_seller has no row - run the seed migration first.")
    seller = dict(row)
    for col in ("gst_rates", "bank"):
        if isinstance(seller.get(col), str):
            seller[col] = json.loads(seller[col])
    return seller


async def load_buyers(db: AsyncSession) -> dict:
    rows = (await db.execute(
        text("SELECT * FROM invoice_buyers ORDER BY key;")
    )).mappings().all()
    return {r["key"]: dict(r) for r in rows}


async def get_buyer(db: AsyncSession, key: str) -> dict:
    buyers = await load_buyers(db)
    if key not in buyers:
        raise KeyError(f"Buyer '{key}' not found in invoice_buyers")
    return buyers[key]


def _buyer_key_from_name(name: str) -> str:
    """Short uppercase key from the buyer name, e.g. 'Shree Fertilizers' -> 'SF'."""
    words = [w for w in name.replace("&", " ").replace("-", " ").upper().split() if w]
    key = "".join(w[0] for w in words[:3]) or "BUY"
    return key[:6]


async def create_buyer(db: AsyncSession, data: dict) -> dict:
    """Insert a new buyer; compose billing_address from the structured fields.

    data keys: name (required), key (optional), address_line1, address_line2,
    city, state, state_code, pincode, gstin, contact_name, contact_email,
    contact_phone. Raises KeyError if the key already exists.
    """
    key = (data.get("key") or _buyer_key_from_name(data["name"])).upper()
    exists = (await db.execute(
        text("SELECT 1 FROM invoice_buyers WHERE key = :k;"), {"k": key}
    )).scalar()
    if exists:
        raise KeyError(f"Buyer '{key}' already exists")
    loc = ", ".join(x for x in (data.get("city"), data.get("state")) if x)
    if data.get("pincode"):
        loc += f" - {data['pincode']}" if loc else data["pincode"]
    billing = "\n".join(x for x in (data.get("address_line1"),
                                    data.get("address_line2"), loc) if x)
    row = {
        "key": key,
        "name": data["name"],
        "billing_address": billing or None,
        "delivery_address": data.get("delivery_address"),
        "state": data.get("state"),
        "state_code": data.get("state_code"),
        "gstin": data.get("gstin"),
        "contact_name": data.get("contact_name"),
        "contact_email": data.get("contact_email"),
        "contact_phone": data.get("contact_phone"),
        "address_line1": data.get("address_line1"),
        "address_line2": data.get("address_line2"),
        "city": data.get("city"),
        "pincode": data.get("pincode"),
    }
    await db.execute(
        text("""
            INSERT INTO invoice_buyers (key, name, billing_address, delivery_address,
                state, state_code, gstin, contact_name, contact_email, contact_phone,
                address_line1, address_line2, city, pincode)
            VALUES (:key, :name, :billing_address, :delivery_address,
                :state, :state_code, :gstin, :contact_name, :contact_email, :contact_phone,
                :address_line1, :address_line2, :city, :pincode);
        """),
        row,
    )
    return row


# ---------------------------------------------------------------- transactions

async def load_transactions(db: AsyncSession) -> list:
    rows = (await db.execute(
        text("SELECT * FROM invoice_transactions ORDER BY s_no;")
    )).mappings().all()
    txs = []
    for r in rows:
        t = dict(r)
        t["allocations"] = t["allocations"] or []
        t["amount"] = float(t["amount"] or 0)
        txs.append(t)
    return txs


async def save_transactions(db: AsyncSession, txs: list):
    await db.execute(text("DELETE FROM invoice_transactions;"))
    for t in txs:
        await db.execute(
            text("""
                INSERT INTO invoice_transactions (s_no, date, amount, remarks, bank_ref, allocations, combined_invoice)
                VALUES (:s_no, :date, :amount, :remarks, :bank_ref, :allocations, :combined_invoice);
            """),
            {
                "s_no": t.get("s_no"),
                "date": t.get("date", ""),
                "amount": t.get("amount", 0),
                "remarks": t.get("remarks"),
                "bank_ref": t.get("bank_ref"),
                "allocations": json.dumps(t.get("allocations", []), ensure_ascii=False),
                "combined_invoice": t.get("combined_invoice"),
            },
        )
