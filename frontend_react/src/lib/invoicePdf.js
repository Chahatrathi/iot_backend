import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

// pdfmake 0.3.x exports the vfs object directly; 0.2.x wrapped it as { pdfMake: { vfs } }.
// A hard throw here would be a module-scope crash -> white page, so accept both shapes.
pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts;

// Palette mirrors generators/renderer.py (the .docx output).
const NAVY = '#1A365D';
const DARK = '#0F172A';
const GRAY = '#64748B';
const RED = '#DC2626';
const WHITE = '#FFFFFF';
const LIGHT_BG = '#F8FAFC';
const BORDER = '#D9DEE7';

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------- money (JS mirror of invoice_lib.py)

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function _two(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}

function _three(n) {
  const h = Math.floor(n / 100);
  const rem = n % 100;
  let s = h ? ONES[h] + ' Hundred' : '';
  if (rem) s += (s ? ' ' : '') + _two(rem);
  return s;
}

export function amountInWords(num) {
  num = Math.max(0, round2(num));
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Zero';
  let rem = rupees;
  const crore = Math.floor(rem / 10000000); rem = rem % 10000000;
  const lakh = Math.floor(rem / 100000); rem = rem % 100000;
  const thousand = Math.floor(rem / 1000); rem = rem % 1000;
  const parts = [];
  if (crore) parts.push(_three(crore) + ' Crore');
  if (lakh) parts.push(_two(lakh) + ' Lakh');
  if (thousand) parts.push(_two(thousand) + ' Thousand');
  if (rem) parts.push(_three(rem));
  let text = parts.join(' ');
  if (paise) text += (text ? ' and ' : '') + _two(paise) + ' Paise';
  return text;
}

export function formatInr(amount) {
  amount = round2(parseFloat(amount) || 0);
  const sign = amount < 0 ? '-' : '';
  const a = Math.abs(amount);
  const rupees = Math.floor(a);
  const paise = Math.round((a - rupees) * 100);
  let r = String(rupees);
  if (r.length > 3) {
    const last3 = r.slice(-3);
    let rest = r.slice(0, -3);
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    r = rest + ',' + last3;
  }
  return `${sign}₹${r}.${String(paise).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- tax / declarations (mirror of lib)

function computeTax(order, seller, buyer) {
  if (!seller.gst_registered) return [];
  const taxable = order.items_value || 0;
  const levied = seller.gst_levied !== false;
  const supplyCode = order.shipping_state_code || buyer.state_code;
  const r = seller.gst_rates || {};
  if ((seller.state_code || '') === (supplyCode || '')) {
    const cgst = r.cgst || 0, sgst = r.sgst || 0;
    return [
      { label: 'CGST', rate: cgst, amount: levied ? round2(taxable * cgst / 100) : 0 },
      { label: 'SGST', rate: sgst, amount: levied ? round2(taxable * sgst / 100) : 0 },
    ];
  }
  const igst = r.igst || 0;
  return [{ label: 'IGST', rate: igst, amount: levied ? round2(taxable * igst / 100) : 0 }];
}

function titleBadge(seller) {
  if (!seller.gst_registered) return `GST registration pending · ARN ${seller.arn || ''}`;
  const head = seller.gstin ? `GSTIN: ${seller.gstin}` : 'GST registered';
  return seller.gst_levied === false ? `${head} · No GST collected` : head;
}

function gstDeclaration(seller, buyer) {
  if (seller.gst_registered) {
    if (seller.gst_levied !== false) {
      return `Tax Invoice issued under the CGST Act, 2017. Reverse charge is applicable: No. Place of supply: ${buyer.state}.`;
    }
    return 'This invoice states the applicable tax head (IGST or CGST + SGST) as per the place of supply, but no Goods and Services Tax (GST) has been collected on this supply. Reverse charge applicable: No.';
  }
  return `This document is a Commercial Invoice issued prior to GSTIN allotment. GST registration is currently under processing with Application Reference Number (ARN): ${seller.arn || ''}. No Goods and Services Tax (GST) has been levied on this bill. A Revised Tax Invoice will be issued upon receipt of the final GST Registration Certificate, as per applicable statutory rules under Section 31(3)(a) of the CGST Act, 2017.`;
}

function eWayNote(order, seller) {
  const required = order.goods && (order.items || []).length && (order.contract_value || 0) > 50000;
  if (!required) return null;
  return seller.gst_registered
    ? 'E-WAY BILL: consignment value exceeds ₹50,000, so an e-way bill is required under Rule 138 regardless of mode of transport. As the registered supplier, Aracharat Ventures LLP should generate it.'
    : 'E-WAY BILL: consignment value exceeds ₹50,000, so an e-way bill is required under Rule 138 regardless of mode of transport. As the registered recipient, the buyer is the deemed cause of movement and should generate it.';
}

// ---------------------------------------------------------------- document model

const TITLES = {
  PO: (order) => (order.account === 'consultation' ? 'CONSULTATION SERVICE ORDER' : 'PURCHASE ORDER'),
  ADVANCE: (order) => (order.account === 'consultation' ? 'CONSULTATION FEE INVOICE' : 'ADVANCE INVOICE'),
  PARTIAL: (order) => (order.account === 'consultation' ? 'CONSULTATION FEE INVOICE' : 'PARTIAL PAYMENT INVOICE'),
  FINAL: (order) => (order.account === 'consultation' ? 'CONSULTATION FEE INVOICE' : 'FINAL INVOICE'),
  REVISED: () => 'REVISED TAX INVOICE',
  CN: () => 'CREDIT NOTE',
  DN: () => 'DEBIT NOTE',
};

function notesList(order) {
  const notes = [];
  if (order.payment_terms) notes.push(`Payment terms: ${order.payment_terms}`);
  if (order.delivery_terms) notes.push(`Delivery: ${order.delivery_terms}`);
  if (order.validity) notes.push(`Validity: ${order.validity}`);
  if (order.remarks) notes.push(order.remarks);
  return notes;
}

function totalsRows({ kind, order, seller, buyer }) {
  const rows = [];
  const levied = seller.gst_registered && seller.gst_levied !== false;

  if (kind === 'PO') {
    rows.push({ label: 'Subtotal', value: formatInr(order.items_value || 0) });
    if (order.freight) rows.push({ label: 'Freight', value: formatInr(order.freight) });
    if (order.discount) rows.push({ label: 'Discount', value: formatInr(-order.discount) });
    rows.push({ label: 'TOTAL PO VALUE', value: formatInr(order.contract_value), bold: true });
    rows.push({ label: 'Amount in words', value: 'Indian Rupees ' + amountInWords(order.contract_value) + ' Only' });
    return rows;
  }

  if (order.items_value != null) rows.push({ label: 'Subtotal', value: formatInr(order.items_value) });
  if (order.freight) rows.push({ label: order.freight_in_rate ? 'Freight (included in rate)' : 'Freight', value: formatInr(order.freight) });
  if (order.discount) rows.push({ label: 'Discount', value: formatInr(-order.discount) });

  const taxRows = computeTax(order, seller, buyer);
  let taxSum = 0;
  if (seller.gst_registered) {
    for (const t of taxRows) {
      taxSum += t.amount;
      rows.push({ label: `${t.label} @ ${t.rate}%${levied ? '' : ' (no GST collected)'}`, value: formatInr(t.amount) });
    }
  } else {
    rows.push({ label: `GST - not levied; registration pending under ARN ${seller.arn || ''}`, value: formatInr(0) });
  }
  const grand = round2((order.contract_value || 0) + taxSum);
  if (levied) {
    rows.push({ label: 'TOTAL (excl. GST)', value: formatInr(order.contract_value) });
    rows.push({ label: 'GRAND TOTAL (incl. GST)', value: formatInr(grand) });
  } else {
    rows.push({ label: 'TOTAL', value: formatInr(order.contract_value) });
  }

  if (kind === 'REVISED') {
    rows.push({ label: 'Less: Already received against original invoice', value: formatInr(order.cumulative_billed || 0) });
    rows.push({ label: 'NET BALANCE DUE (incl. GST)', value: formatInr(round2(grand - (order.cumulative_billed || 0))), highlight: true });
    return rows;
  }

  if (kind === 'ADVANCE' && order.payments && order.payments.length) {
    const lastPay = order.payments[order.payments.length - 1];
    rows.push({ label: `Less: Advance received (${lastPay.date || ''})`, value: formatInr(lastPay.amount || 0) });
  }
  if (kind === 'FINAL') {
    for (const pay of order.payments || []) {
      rows.push({ label: `Less: Advance received ${pay.date || ''} (${pay.mode || ''})`, value: formatInr(pay.amount || 0) });
    }
  }
  rows.push({ label: 'NET BALANCE DUE', value: formatInr(Math.max(0, grand - (order.cumulative_billed || 0))), highlight: true });
  return rows;
}

function shipToLines(order, buyer) {
  const ship = order.shipping_address || buyer.delivery_address;
  if (!ship || ship === buyer.billing_address) return null;
  return Array.isArray(ship) ? ship.map((l) => String(l)) : String(ship).split('\n').filter((l) => l.trim());
}

// ---------------------------------------------------------------- pdfmake layout

function metaRow(meta) {
  return {
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 4, paddingBottom: () => 4 },
    table: {
      widths: ['*', '*', '*', '*'],
      body: [[...meta.map(([label, value]) => ({ fillColor: LIGHT_BG, stack: [
        { text: label.toUpperCase(), fontSize: 6.5, bold: true, color: GRAY, characterSpacing: 0.4 },
        { text: value, fontSize: 8.5, bold: true, color: DARK, margin: [0, 1, 0, 0] },
      ] }))]],
    },
  };
}

function partyBlock(title, lines) {
  return {
    fillColor: LIGHT_BG,
    stack: [
      { text: title.toUpperCase(), fontSize: 6.5, bold: true, color: GRAY, characterSpacing: 0.4 },
      ...lines.map((ln, i) => ({ text: ln, fontSize: 8, bold: i === 0, color: DARK, margin: [0, 1.5, 0, 0] })),
    ],
  };
}

function itemsTable(order) {
  const hourly = order.account === 'consultation';
  const headers = hourly
    ? ['S.No', 'Description of Service', 'SAC/HSN', 'Hours', '₹ / Hour', 'Amount (₹)']
    : ['S.No', 'Item & Description', 'HSN', 'Qty', 'Unit Price (₹)', 'Amount (₹)'];
  const widths = hourly ? [0.5, '*', 0.8, 0.8, 0.9, 1.1] : [0.5, '*', 0.8, 0.9, 1.1, 1.1];
  const body = [
    headers.map((h) => ({ text: h, alignment: 'center', color: WHITE, bold: true })),
    ...(order.items || []).map((itm, idx) => {
      const desc = itm.description + (itm.specs ? '\n' + itm.specs : '');
      const qtyDisp = hourly ? String(itm.qty) + ' HRS' : (String(itm.qty) + ' ' + (itm.uqc || '')).trim();
      const rateDisp = hourly ? formatInr(itm.rate) + ' / hr' : formatInr(itm.rate);
      return [
        { text: String(idx + 1), alignment: 'center' },
        { text: desc },
        { text: itm.hsn || '-', alignment: 'center' },
        { text: qtyDisp, alignment: 'center' },
        { text: rateDisp, alignment: 'right' },
        { text: formatInr((itm.qty || 0) * (itm.rate || 0)), alignment: 'right' },
      ];
    }),
  ];
  return {
    layout: { fillColor: (row) => (row === 0 ? NAVY : null), hLineColor: () => BORDER, vLineColor: () => BORDER },
    table: { widths, body },
    fontSize: 7.5,
  };
}

function milestonesTable(order) {
  if (!order.milestones || !order.milestones.length) return null;
  const body = [
    ['S.No', 'Milestone', '% of Value', 'Trigger / Due'].map((h) => ({ text: h, alignment: 'center', color: WHITE, bold: true })),
    ...order.milestones.map((m, idx) => [
      { text: String(idx + 1), alignment: 'center' },
      { text: m.label || '' },
      { text: (m.percent != null ? m.percent : '') + '%', alignment: 'center' },
      { text: m.trigger || '' },
    ]),
  ];
  return {
    layout: { fillColor: (row) => (row === 0 ? NAVY : null), hLineColor: () => BORDER, vLineColor: () => BORDER },
    table: { widths: [0.6, '*', 1.1, 1.9], body },
    fontSize: 7.5,
  };
}

function paymentTracking(order) {
  const payments = order.payments || [];
  if (!payments.length) return null;
  const body = [
    ['Date', 'Mode', 'Remark', 'Amount (₹)'].map((h) => ({ text: h, alignment: 'center', color: WHITE, bold: true })),
    ...payments.map((p) => [
      { text: p.date || '', alignment: 'center' },
      { text: p.mode || '', alignment: 'center' },
      { text: p.remark || '' },
      { text: formatInr(p.amount || 0), alignment: 'right' },
    ]),
    [
      { text: 'Cumulative payments received', bold: true, fillColor: LIGHT_BG, colSpan: 3 },
      {},
      {},
      { text: formatInr(order.cumulative_billed || 0), bold: true, alignment: 'right', fillColor: LIGHT_BG },
    ],
  ];
  return {
    layout: { fillColor: (row) => (row === 0 ? NAVY : null), hLineColor: () => BORDER, vLineColor: () => BORDER },
    table: { widths: [1, 1.2, '*', 1.4], body },
    fontSize: 7.5,
  };
}

function totalsTable(rows) {
  const body = rows.map((r) => [
    { text: r.label, fontSize: 7.5, bold: !!r.bold || !!r.highlight, color: DARK, fillColor: r.highlight ? LIGHT_BG : null },
    { text: r.value, alignment: 'right', fontSize: 8, bold: !!r.bold || !!r.highlight, color: r.highlight ? RED : DARK, fillColor: r.highlight ? LIGHT_BG : null },
  ]);
  return {
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 2.5, paddingBottom: () => 2.5 },
    table: { widths: ['*', 1.6], body },
  };
}

function footer(seller, withBank) {
  const bank = seller.bank || {};
  const left = withBank
    ? {
        stack: [
          { text: 'PAYMENT REMITTANCE DETAILS', fontSize: 6.5, bold: true, color: GRAY, characterSpacing: 0.4 },
          { text: `Bank Name: ${bank.bank_name || ''}`, fontSize: 7.5, margin: [0, 3, 0, 0] },
          { text: `Account Name: ${bank.account_name || ''}`, fontSize: 7.5 },
          { text: `Account Number: ${bank.account_number || 'TBD'}`, fontSize: 7.5 },
          { text: `IFSC Code: ${bank.ifsc || 'TBD'}`, fontSize: 7.5 },
          ...(bank.note ? [{ text: bank.note, fontSize: 6.5, italics: true, color: RED, margin: [0, 3, 0, 0] }] : []),
        ],
      }
    : { text: '' };
  const right = {
    stack: [
      { text: '' },
      { text: 'For Aracharat Ventures LLP', fontSize: 8, bold: true, margin: [0, 14, 0, 0] },
      { text: 'Authorised Signatory', fontSize: 7, color: GRAY },
      { text: 'Designated Partner', fontSize: 7, color: GRAY },
    ],
    alignment: 'right',
  };
  return {
    layout: { hLineColor: () => BORDER, vLineColor: () => BORDER },
    table: { widths: ['*', '*'], body: [[left, right]] },
    margin: [0, 14, 0, 0],
  };
}

// ---------------------------------------------------------------- builder

export function buildInvoiceDocDefinition({ kind, docNo, docDate, order, seller, buyer }) {
  const title = TITLES[kind](order);
  const ship = shipToLines(order, buyer);
  const notes = notesList(order);
  const rows = totalsRows({ kind, order, seller, buyer });
  const eWay = kind === 'FINAL' ? eWayNote(order, seller) : null;
  const pos = order.place_of_supply || `${buyer.state} (${buyer.state_code})`;

  const content = [
    // 1. Masthead
    {
      layout: { hLineColor: () => BORDER, vLineColor: () => BORDER, paddingTop: () => 5, paddingBottom: () => 5, paddingLeft: () => 6, paddingRight: () => 6 },
      table: {
        widths: ['*', 2.6],
        body: [[
          { stack: [
            { text: (seller.name || '').toUpperCase(), fontSize: 15, bold: true, color: NAVY },
            { text: `${seller.entity_type} · LLPIN: ${seller.llpin} · PAN: ${seller.pan}`, fontSize: 7.5, margin: [0, 2, 0, 0] },
            { text: seller.registered_office || '', fontSize: 7.5 },
            { text: `Email: ${seller.email}  |  Phone: ${seller.phone}`, fontSize: 7.5 },
          ] },
          { alignment: 'right', stack: [
            { text: title, fontSize: 14, bold: true, color: NAVY },
            { text: titleBadge(seller), fontSize: 7, color: GRAY, margin: [0, 2, 0, 0] },
          ] },
        ]],
      },
    },
    // 2. Metadata row
    { text: '', fontSize: 3 },
    metaRow([
      [kind === 'PO' ? 'PO Number' : kind === 'CN' || kind === 'DN' ? 'Document Number' : 'Invoice Number', docNo],
      [kind === 'PO' ? 'PO Date' : kind === 'CN' || kind === 'DN' ? 'Document Date' : 'Invoice Date', docDate],
      ['Place of Supply', pos],
      ['Payment Terms', order.payment_terms || 'Due on receipt'],
    ]),
    { text: '', fontSize: 3 },
    // 3. Parties
    {
      layout: { hLineColor: () => BORDER, vLineColor: () => BORDER, paddingTop: () => 6, paddingBottom: () => 6, paddingLeft: () => 6, paddingRight: () => 6 },
      table: {
        widths: ['*', '*'],
        body: [[
          partyBlock('Issued by', [
            seller.name, seller.registered_office || '',
            `LLPIN: ${seller.llpin}  |  PAN: ${seller.pan}`,
            seller.gst_registered ? `GSTIN: ${seller.gstin || ''}${seller.gst_levied === false ? '  ·  No GST collected' : ''}` : `GST Status: Registration in progress (ARN: ${seller.arn || ''})`,
            `Email: ${seller.email}  |  Phone: ${seller.phone}`,
          ]),
          partyBlock('Billed to', [
            buyer.name, buyer.billing_address || '',
            `GSTIN: ${buyer.gstin || ''}`,
            `Contact: ${buyer.contact_name || ''} - ${buyer.contact_email || ''}`,
            `Phone: ${buyer.contact_phone || ''}`,
          ]),
        ]],
      },
    },
    // 4. Ship to
    ...(ship ? [
      { text: '', fontSize: 3 },
      {
        layout: { hLineColor: () => BORDER, vLineColor: () => BORDER, paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 6, paddingRight: () => 6 },
        table: { widths: ['*'], body: [[
          { stack: [{ text: 'SHIP TO', fontSize: 6.5, bold: true, color: GRAY, characterSpacing: 0.4 }, ...ship.map((ln, i) => ({ text: ln, fontSize: 8, bold: i === 0, color: DARK, margin: [0, 1.5, 0, 0] }))], fillColor: LIGHT_BG },
        ]] },
      },
    ] : []),
    { text: '', fontSize: 3 },
    // 5. Items
    itemsTable(order),
    // 6. Milestones (PO only)
    ...(kind === 'PO' && milestonesTable(order) ? [{ text: '', fontSize: 3 }, { text: 'PAYMENT MILESTONES', fontSize: 7, bold: true, color: GRAY, characterSpacing: 0.4, margin: [0, 4, 0, 2] }, milestonesTable(order)] : []),
    // 7. Payment tracking (invoices)
    ...(kind !== 'PO' && kind !== 'CN' && kind !== 'DN' && paymentTracking(order) ? [
      { text: '', fontSize: 3 },
      { text: kind === 'ADVANCE' ? 'ADVANCE RECEIPT' : kind === 'FINAL' ? 'PAYMENTS RECEIVED AGAINST THIS ORDER' : 'PAYMENT TRACKING', fontSize: 7, bold: true, color: GRAY, characterSpacing: 0.4, margin: [0, 4, 0, 2] },
      paymentTracking(order),
    ] : []),
    // 8. Notes + totals
    {
      columns: [
        {
          width: '*',
          stack: [
            ...(notes.length ? [
              { text: kind === 'PO' ? 'TERMS & CONDITIONS' : 'TERMS & NOTES', fontSize: 7, bold: true, color: GRAY, characterSpacing: 0.4, margin: [0, 4, 0, 2] },
              ...notes.map((n) => ({ text: n, fontSize: 7.5, color: DARK, margin: [0, 1, 0, 0] })),
            ] : []),
            ...(eWay ? [{ text: eWay, fontSize: 6.5, color: RED, margin: [0, 6, 0, 0] }] : []),
            ...(kind === 'REVISED' ? [{ text: `This is a Revised Tax Invoice issued under Section 31(3)(a) of the CGST Act, 2017 read with Rule 53(2), revising original invoice ${docNo.includes('RV') ? 'as referenced' : ''} and levying the GST that was not collected on the original supply.`, fontSize: 6.5, color: DARK, margin: [0, 6, 0, 0] }] : []),
          ],
        },
        { width: 2.9, stack: [totalsTable(rows)] },
      ],
    },
    // 9. Declaration
    { text: 'STATUTORY TAX DECLARATION', fontSize: 7, bold: true, color: GRAY, characterSpacing: 0.4, margin: [0, 8, 0, 2] },
    { text: gstDeclaration(seller, buyer), fontSize: 7, color: DARK, margin: [0, 0, 0, 2] },
    // 10. Footer
    footer(seller, kind !== 'PO' && kind !== 'CN' && kind !== 'DN'),
    { text: `Computer-generated document. Subject to ${seller.jurisdiction || ''} jurisdiction.`, fontSize: 6.5, color: GRAY, margin: [0, 6, 0, 0] },
  ];

  return {
    pageSize: 'A4',
    pageMargins: [43, 36, 43, 36],
    content,
    defaultStyle: { font: 'Roboto', fontSize: 8, color: DARK },
  };
}

export function downloadInvoicePdf({ kind, docNo, docDate, order, seller, buyer }) {
  const dd = buildInvoiceDocDefinition({ kind, docNo, docDate, order, seller, buyer });
  const filename = (docNo || 'document').replace(/\//g, '_') + '.pdf';
  pdfMake.createPdf(dd).download(filename);
}
