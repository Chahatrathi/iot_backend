import React, { useEffect, useState } from 'react';
import { X, FileText, PlusCircle, Download, FileDown, Receipt, ClipboardList, BookOpenCheck, Wallet, Loader2, BarChart3 } from 'lucide-react';
import { API_BASE_URL, authFetch } from '../App';
import { downloadInvoicePdf } from '../lib/invoicePdf';

const ACCOUNTS = [
  { value: 'hardware', label: 'Hardware / Sensors' },
  { value: 'software', label: 'Software / Telemetry' },
  { value: 'fertilizer', label: 'Fertilizer / Biomass' },
  { value: 'consultation', label: 'Consultation (hourly)' },
];

const INDIAN_STATES = [
  { code: '01', name: 'Jammu & Kashmir' }, { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' }, { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' }, { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' }, { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' }, { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' }, { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' }, { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' }, { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' }, { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' }, { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' }, { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' }, { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' }, { code: '27', name: 'Maharashtra' },
  { code: '28', name: 'Andhra Pradesh' }, { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' }, { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' }, { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' }, { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' }, { code: '37', name: 'Andhra Pradesh (new)' },
  { code: '38', name: 'Ladakh' },
];

const ANALYTICS_TYPES = ['Sensors', 'Consulting', 'Fertilizer', 'Other'];
const ANALYTICS_TYPE_FROM_ACCOUNT = { hardware: 'Sensors', freight: 'Sensors', consultation: 'Consulting', fertilizer: 'Fertilizer' };
const ANALYTICS_TYPE_COLORS = { Sensors: '#2563eb', Consulting: '#7c3aed', Fertilizer: '#0e7a4d', Other: '#9ca3af' };
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const STATE_COLORS = {
  CREATED: 'bg-blue-950 text-blue-400 border border-blue-900',
  'ADVANCE-PAID': 'bg-amber-950 text-amber-400 border border-amber-900',
  'PARTIAL-BILLED': 'bg-amber-950 text-amber-400 border border-amber-900',
  SHIPPED: 'bg-cyan-950 text-cyan-400 border border-cyan-900',
  SETTLED: 'bg-green-950 text-green-400 border border-green-800',
};

function fmtInr(n) {
  return '₹' + (Math.round((parseFloat(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const docUrl = (poNo, docNo) =>
  `${API_BASE_URL}/api/invoices/orders/${encodeURIComponent(poNo)}/documents/${encodeURIComponent(docNo)}`;

function RegisterView({ session }) {
  const [reg, setReg] = useState(null);
  const [loadingReg, setLoadingReg] = useState(false);
  useEffect(() => {
    (async () => {
      setLoadingReg(true);
      try {
        const res = await authFetch(session, `${API_BASE_URL}/api/invoices/register`);
        if (res.ok) setReg(await res.json());
      } finally { setLoadingReg(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-5">
      <h3 className="text-sm font-mono text-gray-400 mb-4">SERIAL REGISTER — FINANCIAL YEAR {reg?.fy || '...'}</h3>
      {loadingReg ? <p className="text-xs font-mono text-gray-500 animate-pulse">LOADING REGISTER...</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(reg?.series || {}).map(([kind, series]) => (
            <div key={kind} className="bg-[#0d1117] border border-[#21262d] rounded-lg p-4">
              <div className="text-[11px] font-mono text-[#f5c542] mb-2">SERIES {kind}</div>
              {Object.entries(series).map(([tag, st]) => (
                <div key={tag} className="flex justify-between text-xs font-mono text-gray-300 py-0.5">
                  <span>{kind === 'CMB' ? 'combined' : tag || '(untagged)'}</span>
                  <span className="text-gray-500">last: {String(st.last_seq).padStart(3, '0')}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportView({ session }) {
  const [rep, setRep] = useState(null);
  const [loadingRep, setLoadingRep] = useState(false);
  useEffect(() => {
    (async () => {
      setLoadingRep(true);
      try {
        const res = await authFetch(session, `${API_BASE_URL}/api/invoices/report`);
        if (res.ok) setRep(await res.json());
      } finally { setLoadingRep(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="bg-[#161b22] border border-[#21262d] rounded-xl overflow-hidden">
      <div className="p-4 border-b border-[#21262d] flex justify-between items-center">
        <h3 className="text-sm font-mono text-gray-400">OPEN BALANCES PER ORDER</h3>
        <span className="text-xs font-mono text-red-400">Total outstanding: {rep ? fmtInr(rep.total_outstanding) : '...'}</span>
      </div>
      {loadingRep ? <p className="p-6 text-xs font-mono text-gray-500 animate-pulse">LOADING REPORT...</p> : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#21262d] bg-[#0d1117] text-xs font-mono tracking-wider text-gray-400">
              <th className="p-3">PO NUMBER</th><th className="p-3">STATE</th><th className="p-3 text-right">VALUE</th>
              <th className="p-3 text-right">PAID</th><th className="p-3 text-right">BALANCE DUE</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#21262d] text-sm">
            {(rep?.orders || []).map((r) => (
              <tr key={r.po_no} className="hover:bg-[#1f242c]">
                <td className="p-3 font-mono text-[#22d3ee]">{r.po_no}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded text-[10px] font-mono ${STATE_COLORS[r.state] || ''}`}>{r.state}</span></td>
                <td className="p-3 text-right font-mono">{fmtInr(r.contract_value)}</td>
                <td className="p-3 text-right font-mono text-gray-400">{fmtInr(r.cumulative_billed)}</td>
                <td className={`p-3 text-right font-mono ${r.balance_due > 0 ? 'text-red-400' : 'text-green-400'}`}>{fmtInr(r.balance_due)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AnalyticsView({ orders }) {
  const valid = (orders || []).filter((o) => o.po_date && o.state !== 'CANCELLED');
  const byMonth = {};
  const monthOrders = {};
  for (const o of valid) {
    const m = String(o.po_date).slice(0, 7);
    const t = ANALYTICS_TYPE_FROM_ACCOUNT[o.account] || 'Other';
    const bal = Math.max(0, (o.contract_value || 0) - (o.cumulative_billed || 0) + (o.freight || 0) - (o.discount || 0));
    byMonth[m] = byMonth[m] || {};
    byMonth[m][t] = (byMonth[m][t] || 0) + (o.contract_value || 0);
    (monthOrders[m] = monthOrders[m] || []).push({ po_no: o.po_no, type: t, value: o.contract_value || 0, balance: bal });
  }
  const months = Object.keys(byMonth).sort();
  const totals = {};
  ANALYTICS_TYPES.forEach((t) => { totals[t] = months.reduce((s, m) => s + (byMonth[m][t] || 0), 0); });
  const grand = ANALYTICS_TYPES.reduce((s, t) => s + totals[t], 0);
  const monthBalance = {};
  months.forEach((m) => { monthBalance[m] = monthOrders[m].reduce((s, r) => s + r.balance, 0); });
  const totalBalance = months.reduce((s, m) => s + monthBalance[m], 0);
  const maxCell = Math.max(1, ...months.flatMap((m) => ANALYTICS_TYPES.map((t) => byMonth[m][t] || 0)));
  const countOf = (t) => valid.filter((o) => (ANALYTICS_TYPE_FROM_ACCOUNT[o.account] || 'Other') === t).length;
  const monthLabel = (m) => `${MONTH_NAMES[parseInt(m.slice(5, 7), 10) - 1]} ${m.slice(0, 4)}`;

  const cards = [
    { k: 'Total orders received', v: grand, s: `${valid.length} POs, by PO date` },
    { k: 'Amount to be received', v: totalBalance, s: `${fmtInr(grand - totalBalance)} already billed/paid` },
    { k: 'Sensors', v: totals.Sensors, s: `${countOf('Sensors')} POs` },
    { k: 'Consulting', v: totals.Consulting, s: totals.Consulting === 0 ? 'No consulting orders yet' : `${countOf('Consulting')} POs` },
    { k: 'Fertilizer', v: totals.Fertilizer, s: `${countOf('Fertilizer')} POs` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.k} className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4">
            <div className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">{c.k}</div>
            <div className="text-lg font-bold text-white mt-1 font-mono">{fmtInr(c.v)}</div>
            <div className="text-[11px] text-gray-500 mt-1">{c.s}</div>
          </div>
        ))}
      </div>

      <div className="bg-[#161b22] border border-[#21262d] rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[#21262d]">
          <h3 className="text-sm font-mono text-gray-400">MONTH-ON-MONTH ORDERS RECEIVED</h3>
          <p className="text-[11px] text-gray-500 mt-1">By income type, valued at order (PO) contract value. Cancelled POs excluded. Freight is grouped under Sensors. "To receive" is the outstanding balance on each month's orders.</p>
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#21262d] bg-[#0d1117] text-xs font-mono tracking-wider text-gray-400">
              <th className="p-3">MONTH</th>
              {ANALYTICS_TYPES.map((t) => <th key={t} className="p-3 text-right">{t.toUpperCase()}</th>)}
              <th className="p-3 text-right">TOTAL</th><th className="p-3 text-right">TO RECEIVE</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#21262d] text-sm">
            {months.map((m) => (
              <tr key={m} className="hover:bg-[#1f242c]">
                <td className="p-3 font-mono text-gray-200"><b>{monthLabel(m)}</b></td>
                {ANALYTICS_TYPES.map((t) => {
                  const v = byMonth[m][t] || 0;
                  const pct = Math.round((v / maxCell) * 100);
                  return (
                    <td key={t} className="p-3 text-right font-mono">
                      {fmtInr(v)}
                      <div className="h-1 bg-[#21262d] rounded-full mt-1 ml-auto" style={{ width: 44 }}>
                        <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: ANALYTICS_TYPE_COLORS[t] }} />
                      </div>
                    </td>
                  );
                })}
                <td className="p-3 text-right font-mono text-white"><b>{fmtInr(Object.values(byMonth[m]).reduce((s, v) => s + v, 0))}</b></td>
                <td className="p-3 text-right font-mono">{fmtInr(monthBalance[m])}</td>
              </tr>
            ))}
            {months.length > 0 && (
              <tr className="bg-[#0d1117]">
                <td className="p-3 font-mono text-gray-200"><b>Total</b></td>
                {ANALYTICS_TYPES.map((t) => <td key={t} className="p-3 text-right font-mono text-white"><b>{fmtInr(totals[t])}</b></td>)}
                <td className="p-3 text-right font-mono text-white"><b>{fmtInr(grand)}</b></td>
                <td className="p-3 text-right font-mono text-red-400"><b>{fmtInr(totalBalance)}</b></td>
              </tr>
            )}
            {!months.length && <tr><td colSpan={ANALYTICS_TYPES.length + 3} className="p-6 text-center text-sm font-mono text-gray-500">No orders yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-4">
        <h3 className="text-sm font-mono text-gray-400 mb-3">ORDERS BY MONTH</h3>
        {months.map((m) => (
          <div key={m} className="mb-4">
            <h4 className="text-xs font-mono text-[#f5c542] mb-2">
              {monthLabel(m)} — {fmtInr(monthOrders[m].reduce((s, r) => s + r.value, 0))}{' '}
              <span className="text-gray-500">({fmtInr(monthBalance[m])} to receive)</span>
            </h4>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#21262d] text-xs font-mono tracking-wider text-gray-500">
                  <th className="py-2">PO</th><th className="py-2">INCOME TYPE</th>
                  <th className="py-2 text-right">VALUE</th><th className="py-2 text-right">TO RECEIVE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#21262d] text-sm">
                {monthOrders[m].slice().sort((a, b) => a.po_no.localeCompare(b.po_no)).map((r) => (
                  <tr key={r.po_no}>
                    <td className="py-2 font-mono text-[#22d3ee]">{r.po_no}</td>
                    <td className="py-2 font-mono text-gray-400">{r.type}</td>
                    <td className="py-2 text-right font-mono text-gray-200">{fmtInr(r.value)}</td>
                    <td className="py-2 text-right font-mono">{fmtInr(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {!months.length && <p className="text-sm font-mono text-gray-500">No orders yet.</p>}
      </div>
    </div>
  );
}

export default function InvoicingModule({ session, onClose }) {
  const [activeTab, setActiveTab] = useState('bills');
  const [orders, setOrders] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);   // {order, seller, buyer}
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Create-PO form
  const [poForm, setPoForm] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Action forms per order drawer
  const [action, setAction] = useState(null); // 'ADVANCE' | 'PARTIAL' | 'FINAL' | 'REVISED' | 'CN' | 'DN'
  const [actionForm, setActionForm] = useState({ amount: '', date: '', mode: 'NEFT', remark: '', reason: '', ref: '', orig: '' });
  const [actionBusy, setActionBusy] = useState(false);

  const loadOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(session, `${API_BASE_URL}/api/invoices/orders`);
      if (!res.ok) throw new Error((await res.json())?.detail || 'Failed to load orders');
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadBuyers = async () => {
    try {
      const res = await authFetch(session, `${API_BASE_URL}/api/invoices/buyers`);
      if (res.ok) setBuyers((await res.json()).buyers || []);
    } catch (e) {
      console.error('Failed to load buyers:', e);
    }
  };

  useEffect(() => {
    loadOrders();
    loadBuyers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openOrder = async (poNo) => {
    setDetailLoading(true);
    setError(null);
    setAction(null);
    try {
      const res = await authFetch(session, `${API_BASE_URL}/api/invoices/orders/${encodeURIComponent(poNo)}`);
      if (!res.ok) throw new Error((await res.json())?.detail || 'Failed to load order');
      setSelectedOrder(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  // ---------------------------------------------------------------- actions

  const runAction = async () => {
    const { order, seller, buyer } = selectedOrder;
    const pathMap = { ADVANCE: 'advance', PARTIAL: 'partial', FINAL: 'final', REVISED: 'revised', CN: 'cn', DN: 'dn' };
    const body = {};
    if (action === 'FINAL') {
      body.date = actionForm.date || undefined;
    } else if (action === 'REVISED') {
      body.date = actionForm.date || undefined;
      body.orig = actionForm.orig || undefined;
    } else if (action === 'CN' || action === 'DN') {
      body.amount = parseFloat(actionForm.amount);
      body.date = actionForm.date || undefined;
      body.ref = actionForm.ref || '';
      body.reason = actionForm.reason || '';
    } else {
      body.amount = parseFloat(actionForm.amount);
      body.date = actionForm.date || undefined;
      body.mode = actionForm.mode || 'NEFT';
      body.remark = actionForm.remark || '';
    }

    setActionBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await authFetch(session, `${API_BASE_URL}/api/invoices/orders/${encodeURIComponent(order.po_no)}/${pathMap[action]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Action failed');

      const doc = data.document;
      setNotice(`${doc.kind === 'PO' ? 'PO' : doc.kind} ${doc.no} issued — PDF generated automatically.`);
      setSelectedOrder({ order: data.order, seller, buyer });
      setAction(null);
      setActionForm({ amount: '', date: '', mode: 'NEFT', remark: '', reason: '', ref: '', orig: '' });
      loadOrders();

      // Automatic PDF generation (client-side, mirrors the .docx)
      const pdfKind = doc.kind === 'CN' || doc.kind === 'DN' ? doc.kind : doc.kind;
      downloadInvoicePdf({ kind: pdfKind, docNo: doc.no, docDate: doc.date, order: data.order, seller, buyer });
    } catch (e) {
      setError(e.message);
    } finally {
      setActionBusy(false);
    }
  };

  const createPo = async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const body = { ...poForm };
      if (poForm.buyer === '__new__') {
        const nb = poForm.newBuyer || {};
        if (!nb.name) throw new Error('Buyer name is required for a new buyer');
        const bres = await authFetch(session, `${API_BASE_URL}/api/invoices/buyers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nb),
        });
        const bdata = await bres.json();
        if (!bres.ok) throw new Error(bdata?.detail || 'Buyer creation failed');
        body.buyer = bdata.buyer.key;
      }
      const res = await authFetch(session, `${API_BASE_URL}/api/invoices/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'PO creation failed');

      const doc = data.document;
      setNotice(`Purchase Order ${data.order.po_no} created — PO PDF generated automatically.`);
      setPoForm(null);
      loadOrders();
      loadBuyers();
      downloadInvoicePdf({ kind: 'PO', docNo: data.order.po_no, docDate: data.order.po_date, order: data.order, seller: data.seller || {}, buyer: data.buyer || {} });
      setActiveTab('bills');
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------- render helpers

  const renderTabBar = () => (
    <div className="flex flex-wrap gap-2 border-b border-[#21262d] pb-3 mb-5">
      {[
        { id: 'bills', label: 'Bills & Invoices', icon: Receipt },
        { id: 'create', label: 'Create Purchase Order', icon: PlusCircle },
        { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        { id: 'register', label: 'Register', icon: BookOpenCheck },
        { id: 'report', label: 'Open Balances', icon: Wallet },
      ].map((t) => (
        <button key={t.id} onClick={() => { setActiveTab(t.id); setError(null); }}
          className={`flex items-center px-3.5 py-2 text-xs font-mono rounded-lg border transition-all ${activeTab === t.id ? 'bg-[#f5c542]/10 border-[#f5c542]/40 text-[#f5c542]' : 'bg-[#0d1117] border-[#21262d] text-gray-400 hover:text-gray-200'}`}>
          <t.icon className="w-3.5 h-3.5 mr-1.5" /> {t.label}
        </button>
      ))}
    </div>
  );

  const renderOrderTable = () => (
    <div className="bg-[#161b22] border border-[#21262d] rounded-xl overflow-hidden">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-[#21262d] bg-[#0d1117] text-xs font-mono tracking-wider text-gray-400">
            <th className="p-3">PO NUMBER</th><th className="p-3">BUYER</th><th className="p-3">ACCOUNT</th>
            <th className="p-3">STATE</th><th className="p-3 text-right">VALUE</th><th className="p-3 text-right">PAID</th><th className="p-3 text-right">BALANCE</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#21262d] text-sm">
          {orders.map((o) => (
            <tr key={o.po_no} onClick={() => openOrder(o.po_no)} className="hover:bg-[#1f242c] cursor-pointer transition-colors">
              <td className="p-3 font-mono text-[#22d3ee]">{o.po_no}</td>
              <td className="p-3 text-white">{o.buyer}</td>
              <td className="p-3 font-mono text-gray-400">{o.account}</td>
              <td className="p-3"><span className={`px-2 py-0.5 rounded text-[10px] font-mono ${STATE_COLORS[o.state] || 'bg-gray-950 text-gray-400 border border-gray-800'}`}>{o.state}</span></td>
              <td className="p-3 text-right font-mono">{fmtInr(o.contract_value)}</td>
              <td className="p-3 text-right font-mono text-gray-400">{fmtInr(o.cumulative_billed)}</td>
              <td className={`p-3 text-right font-mono ${o.balance_due > 0 ? 'text-red-400' : 'text-green-400'}`}>{fmtInr(o.balance_due)}</td>
            </tr>
          ))}
          {!orders.length && <tr><td colSpan="7" className="p-6 text-center text-sm font-mono text-gray-500">{loading ? 'LOADING ORDERS...' : 'No purchase orders yet — create one above.'}</td></tr>}
        </tbody>
      </table>
    </div>
  );

  // ---------------------------------------------------------------- create PO form

  const newPoForm = () => ({
    buyer: buyers[0]?.key || 'LCB',
    newBuyer: { active: false, name: '', address_line1: '', address_line2: '', city: '', state: '', state_code: '', pincode: '', gstin: '' },
    account: 'hardware',
    goods: true,
    items: [{ description: '', specs: '', hsn: '', qty: 1, uqc: 'Nos', rate: 0 }],
    milestones: [],
    freight: 0,
    freight_in_rate: false,
    discount: 0,
    shipping_address: [],
    shipping_state_code: '',
    place_of_supply: '',
    payment_terms: '',
    delivery_terms: '',
    validity: 'PO valid for 30 days.',
    remarks: '',
  });

  const renderCreateForm = () => {
    if (!poForm) {
      return (
        <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-6 text-center">
          <PlusCircle className="w-8 h-8 mx-auto text-[#f5c542] mb-3" />
          <p className="text-sm text-gray-400 mb-4">Create a new purchase order — the PO document and PDF are generated automatically on submission.</p>
          <button onClick={() => { setPoForm(newPoForm()); setError(null); }}
            className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors text-sm">
            Start New Purchase Order
          </button>
        </div>
      );
    }

    const set = (k, v) => setPoForm((f) => ({ ...f, [k]: v }));
    const setNB = (k, v) => setPoForm((f) => ({ ...f, newBuyer: { ...f.newBuyer, [k]: v } }));
    const setItem = (i, k, v) => setPoForm((f) => {
      const items = f.items.map((itm, idx) => (idx === i ? { ...itm, [k]: v } : itm));
      return { ...f, items };
    });

    const inputCls = 'w-full bg-[#0d1117] border border-[#21262d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-[#22d3ee] outline-none';
    const labelCls = 'block text-[10px] font-mono text-gray-500 mb-1 tracking-wider';

    return (
      <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-6 space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-mono text-[#f5c542]">NEW PURCHASE ORDER</h3>
          <button onClick={() => setPoForm(null)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>BUYER</label>
            <select className={inputCls} value={poForm.buyer} onChange={(e) => set('buyer', e.target.value)}>
              {buyers.map((b) => <option key={b.key} value={b.key}>{b.name} ({b.key})</option>)}
              <option value="__new__">+ New buyer…</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>ACCOUNT / INCOME STREAM</label>
            <select className={inputCls} value={poForm.account} onChange={(e) => set('account', e.target.value)}>
              {ACCOUNTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center text-sm text-gray-300 space-x-2">
              <input type="checkbox" checked={poForm.goods} onChange={(e) => set('goods', e.target.checked)}
                className="w-4 h-4 accent-[#f5c542]" /> Goods supply (e-way bill rules apply)
            </label>
          </div>
        </div>

        {poForm.buyer === '__new__' && (
          <div className="bg-[#0d1117] border border-[#f5c542]/30 rounded-xl p-4">
            <div className="text-[10px] font-mono text-[#f5c542] mb-3 tracking-wider">BUYER DETAILS — NEW BUYER</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className={labelCls}>NAME *</label>
                <input className={inputCls} value={poForm.newBuyer.name}
                  onChange={(e) => setNB('name', e.target.value)} placeholder="e.g. Shree Fertilizers Pvt. Ltd." />
              </div>
              <div>
                <label className={labelCls}>ADDRESS LINE 1</label>
                <input className={inputCls} value={poForm.newBuyer.address_line1}
                  onChange={(e) => setNB('address_line1', e.target.value)} placeholder="Plot / street / building" />
              </div>
              <div>
                <label className={labelCls}>ADDRESS LINE 2</label>
                <input className={inputCls} value={poForm.newBuyer.address_line2}
                  onChange={(e) => setNB('address_line2', e.target.value)} placeholder="Area / landmark" />
              </div>
              <div>
                <label className={labelCls}>CITY</label>
                <input className={inputCls} value={poForm.newBuyer.city}
                  onChange={(e) => setNB('city', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>PIN CODE</label>
                <input className={inputCls} value={poForm.newBuyer.pincode}
                  onChange={(e) => setNB('pincode', e.target.value)} placeholder="6 digits" />
              </div>
              <div>
                <label className={labelCls}>STATE</label>
                <select className={inputCls} value={poForm.newBuyer.state_code || ''}
                  onChange={(e) => { const st = INDIAN_STATES.find((s) => s.code === e.target.value); setNB('state_code', e.target.value); setNB('state', st ? st.name : ''); }}>
                  <option value="">Select state…</option>
                  {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>GST NUMBER (IF APPLICABLE)</label>
                <input className={inputCls} value={poForm.newBuyer.gstin}
                  onChange={(e) => setNB('gstin', e.target.value)} placeholder="e.g. 09ABCDE1234F1Z5 (optional)" />
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="flex justify-between items-center mb-2">
            <label className={labelCls + ' mb-0'}>LINE ITEMS</label>
            <button onClick={() => set('items', [...poForm.items, { description: '', specs: '', hsn: '', qty: 1, uqc: 'Nos', rate: 0 }])}
              className="text-xs font-mono text-[#22d3ee] hover:text-cyan-300">+ Add Item</button>
          </div>
          <div className="space-y-3">
            {poForm.items.map((itm, i) => (
              <div key={i} className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3 grid grid-cols-1 md:grid-cols-6 gap-3">
                <div className="md:col-span-2">
                  <label className={labelCls}>DESCRIPTION</label>
                  <input className={inputCls} value={itm.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="e.g. ESP32-S3 Sensor Panel" />
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>SPECS</label>
                  <input className={inputCls} value={itm.specs} onChange={(e) => setItem(i, 'specs', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>HSN</label>
                  <input className={inputCls} value={itm.hsn} onChange={(e) => setItem(i, 'hsn', e.target.value)} placeholder="8517 62 90" />
                </div>
                <div className="flex items-end gap-2">
                  <button onClick={() => set('items', poForm.items.filter((_, x) => x !== i))}
                    className="text-xs text-red-400 hover:text-red-300 mb-2">Remove</button>
                </div>
                <div>
                  <label className={labelCls}>QTY</label>
                  <input type="number" className={inputCls} value={itm.qty} onChange={(e) => setItem(i, 'qty', parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <label className={labelCls}>UQC</label>
                  <input className={inputCls} value={itm.uqc} onChange={(e) => setItem(i, 'uqc', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>UNIT RATE (₹)</label>
                  <input type="number" className={inputCls} value={itm.rate} onChange={(e) => setItem(i, 'rate', parseFloat(e.target.value) || 0)} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className={labelCls}>FREIGHT (₹)</label>
            <input type="number" className={inputCls} value={poForm.freight} onChange={(e) => set('freight', parseFloat(e.target.value) || 0)} />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center text-sm text-gray-300 space-x-2">
              <input type="checkbox" checked={poForm.freight_in_rate} onChange={(e) => set('freight_in_rate', e.target.checked)} className="w-4 h-4 accent-[#f5c542]" /> Freight in rate
            </label>
          </div>
          <div>
            <label className={labelCls}>DISCOUNT (₹)</label>
            <input type="number" className={inputCls} value={poForm.discount} onChange={(e) => set('discount', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className={labelCls}>SHIPPING STATE CODE</label>
            <input className={inputCls} value={poForm.shipping_state_code} onChange={(e) => set('shipping_state_code', e.target.value)} placeholder="06 (Haryana)" />
          </div>
        </div>

        <div>
          <label className={labelCls}>SHIPPING ADDRESS (ONE LINE PER ENTRY)</label>
          <textarea className={inputCls + ' h-20'} value={(poForm.shipping_address || []).join('\n')}
            onChange={(e) => set('shipping_address', e.target.value.split('\n').filter((l) => l.trim()))} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>PAYMENT TERMS</label>
            <input className={inputCls} value={poForm.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} placeholder="Advance on PO acceptance; balance on delivery." />
          </div>
          <div>
            <label className={labelCls}>DELIVERY TERMS</label>
            <input className={inputCls} value={poForm.delivery_terms} onChange={(e) => set('delivery_terms', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>VALIDITY</label>
            <input className={inputCls} value={poForm.validity} onChange={(e) => set('validity', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>PLACE OF SUPPLY</label>
            <input className={inputCls} value={poForm.place_of_supply} onChange={(e) => set('place_of_supply', e.target.value)} placeholder="Haryana (06)" />
          </div>
        </div>

        <div>
          <label className={labelCls}>REMARKS</label>
          <textarea className={inputCls} value={poForm.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>PAYMENT MILESTONES (OPTIONAL)</label>
          <div className="space-y-2">
            {poForm.milestones.map((m, i) => (
              <div key={i} className="flex gap-2">
                <input className={inputCls} value={m.label} onChange={(e) => setPoForm((f) => ({ ...f, milestones: f.milestones.map((x, xi) => xi === i ? { ...x, label: e.target.value } : x) }))} placeholder="Milestone label" />
                <input type="number" className={inputCls + ' w-24'} value={m.percent} onChange={(e) => setPoForm((f) => ({ ...f, milestones: f.milestones.map((x, xi) => xi === i ? { ...x, percent: parseFloat(e.target.value) || 0 } : x) }))} placeholder="%" />
                <input className={inputCls} value={m.trigger} onChange={(e) => setPoForm((f) => ({ ...f, milestones: f.milestones.map((x, xi) => xi === i ? { ...x, trigger: e.target.value } : x) }))} placeholder="Trigger" />
                <button onClick={() => set('milestones', poForm.milestones.filter((_, x) => x !== i))} className="text-xs text-red-400">Remove</button>
              </div>
            ))}
            <button onClick={() => set('milestones', [...poForm.milestones, { label: '', percent: 0, trigger: '' }])}
              className="text-xs font-mono text-[#22d3ee] hover:text-cyan-300">+ Add Milestone</button>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={createPo} disabled={submitting || !poForm.items.some((i) => i.description && i.rate > 0)}
            className="flex items-center px-5 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors text-sm disabled:opacity-50">
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
            {submitting ? 'Creating PO...' : 'Create PO & Generate Document'}
          </button>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------- order drawer

  const renderOrderDrawer = () => {
    if (!selectedOrder) return null;
    const { order, seller, buyer } = selectedOrder;
    const showActions = !['SHIPPED', 'SETTLED'].includes(order.state) || true; // revised/CN/DN always available

    const actionDefs = [
      { id: 'ADVANCE', label: 'Advance', color: 'bg-amber-500/10 text-amber-400 border border-amber-500/30' },
      { id: 'PARTIAL', label: 'Partial', color: 'bg-amber-500/10 text-amber-400 border border-amber-500/30' },
      { id: 'FINAL', label: 'Final (Dispatch)', color: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' },
      { id: 'REVISED', label: 'Revised Tax Inv.', color: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30' },
      { id: 'CN', label: 'Credit Note', color: 'bg-red-500/10 text-red-400 border border-red-500/30' },
      { id: 'DN', label: 'Debit Note', color: 'bg-red-500/10 text-red-400 border border-red-500/30' },
    ];

    const actionFields = () => {
      const cls = 'w-full bg-[#0d1117] border border-[#21262d] rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-[#22d3ee] outline-none';
      const lbl = 'block text-[10px] font-mono text-gray-500 mb-1 tracking-wider';
      if (action === 'FINAL') {
        return (
          <div>
            <label className={lbl}>DISPATCH DATE</label>
            <input type="date" className={cls} value={actionForm.date} onChange={(e) => setActionForm({ ...actionForm, date: e.target.value })} />
          </div>
        );
      }
      if (action === 'REVISED') {
        return (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>ORIGINAL INVOICE NO.</label>
              <input className={cls} value={actionForm.orig} onChange={(e) => setActionForm({ ...actionForm, orig: e.target.value })} placeholder="defaults to last invoice" />
            </div>
            <div>
              <label className={lbl}>REVISED DATE</label>
              <input type="date" className={cls} value={actionForm.date} onChange={(e) => setActionForm({ ...actionForm, date: e.target.value })} />
            </div>
          </div>
        );
      }
      if (action === 'CN' || action === 'DN') {
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={lbl}>AMOUNT (₹)</label>
              <input type="number" className={cls} value={actionForm.amount} onChange={(e) => setActionForm({ ...actionForm, amount: e.target.value })} />
            </div>
            <div>
              <label className={lbl}>REFERENCE INVOICE</label>
              <input className={cls} value={actionForm.ref} onChange={(e) => setActionForm({ ...actionForm, ref: e.target.value })} />
            </div>
            <div>
              <label className={lbl}>REASON</label>
              <input className={cls} value={actionForm.reason} onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })} />
            </div>
          </div>
        );
      }
      return (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className={lbl}>AMOUNT (₹)</label>
            <input type="number" className={cls} value={actionForm.amount} onChange={(e) => setActionForm({ ...actionForm, amount: e.target.value })} />
          </div>
          <div>
            <label className={lbl}>DATE</label>
            <input type="date" className={cls} value={actionForm.date} onChange={(e) => setActionForm({ ...actionForm, date: e.target.value })} />
          </div>
          <div>
            <label className={lbl}>MODE</label>
            <input className={cls} value={actionForm.mode} onChange={(e) => setActionForm({ ...actionForm, mode: e.target.value })} />
          </div>
          <div>
            <label className={lbl}>REMARK</label>
            <input className={cls} value={actionForm.remark} onChange={(e) => setActionForm({ ...actionForm, remark: e.target.value })} />
          </div>
        </div>
      );
    };

    return (
      <div className="fixed inset-0 bg-black/70 flex justify-end z-50 backdrop-blur-sm animate-[fadeIn_0.1s_ease-out]">
        <div className="w-full max-w-3xl bg-[#161b22] h-full border-l border-[#21262d] p-6 shadow-2xl flex flex-col overflow-y-auto custom-scrollbar">
          <div className="flex justify-between items-start border-b border-[#21262d] pb-4 mb-4">
            <div>
              <span className="text-xs font-mono text-[#22d3ee]">ORDER DETAIL</span>
              <h3 className="text-xl font-bold text-white mt-1 font-mono">{order.po_no}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${STATE_COLORS[order.state] || ''}`}>{order.state}</span>
                <span className="text-xs text-gray-500">{buyer?.name} · {order.account}</span>
              </div>
            </div>
            <button onClick={() => setSelectedOrder(null)} className="p-1 hover:bg-[#21262d] rounded-lg text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
          </div>

          {detailLoading ? <p className="text-sm font-mono text-gray-500 animate-pulse">FETCHING ORDER DATA...</p> : (
            <>
              {/* Items */}
              <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 mb-4">
                <h4 className="text-[11px] font-mono text-gray-400 mb-2">LINE ITEMS — TOTAL {fmtInr(order.contract_value)}</h4>
                {(order.items || []).map((itm, i) => (
                  <div key={i} className="flex justify-between text-sm py-1.5 border-b border-[#21262d]/50 last:border-0">
                    <span className="text-gray-200">{itm.description}{itm.specs ? <span className="text-gray-500 text-xs"> — {itm.specs}</span> : null}</span>
                    <span className="font-mono text-gray-400">{itm.qty} {itm.uqc} × {fmtInr(itm.rate)}</span>
                  </div>
                ))}
              </div>

              {/* Payments */}
              {(order.payments || []).length > 0 && (
                <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 mb-4">
                  <h4 className="text-[11px] font-mono text-gray-400 mb-2">PAYMENTS RECEIVED — CUMULATIVE {fmtInr(order.cumulative_billed)}</h4>
                  {(order.payments || []).map((p, i) => (
                    <div key={i} className="flex justify-between text-sm py-1.5 border-b border-[#21262d]/50 last:border-0">
                      <span className="text-gray-300">{p.date} · {p.mode} · {p.remark}</span>
                      <span className="font-mono text-gray-300">{fmtInr(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Issued documents */}
              <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 mb-4">
                <h4 className="text-[11px] font-mono text-gray-400 mb-2">ISSUED DOCUMENTS</h4>
                {(order.invoices || []).length === 0 && <p className="text-xs text-gray-500">No invoices issued yet.</p>}
                {(order.invoices || []).map((inv, i) => (
                  <div key={i} className="flex justify-between items-center text-sm py-2 border-b border-[#21262d]/50 last:border-0">
                    <div>
                      <span className="text-gray-300 font-mono">{inv.no}</span>
                      <span className="text-[10px] text-gray-500 ml-2">{inv.kind} · {inv.date}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-gray-300">{fmtInr(inv.amount)}</span>
                      <a href={docUrl(order.po_no, inv.no)} className="flex items-center text-[11px] font-mono text-[#22d3ee] hover:text-cyan-300 border border-[#22d3ee]/30 rounded px-2 py-1">
                        <FileDown className="w-3 h-3 mr-1" /> DOCX
                      </a>
                      <button onClick={() => downloadInvoicePdf({ kind: inv.kind, docNo: inv.no, docDate: inv.date, order, seller, buyer })}
                        className="flex items-center text-[11px] font-mono text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded px-2 py-1">
                        <Download className="w-3 h-3 mr-1" /> PDF
                      </button>
                    </div>
                  </div>
                ))}
                {/* PO document */}
                <div className="flex justify-between items-center text-sm py-2 border-b border-[#21262d]/50 last:border-0 mt-1">
                  <span className="text-gray-300 font-mono">{order.po_no} <span className="text-[10px] text-gray-500 ml-2">PO</span></span>
                  <div className="flex items-center gap-2">
                    <a href={docUrl(order.po_no, order.po_no)} className="flex items-center text-[11px] font-mono text-[#22d3ee] hover:text-cyan-300 border border-[#22d3ee]/30 rounded px-2 py-1">
                      <FileDown className="w-3 h-3 mr-1" /> DOCX
                    </a>
                    <button onClick={() => downloadInvoicePdf({ kind: 'PO', docNo: order.po_no, docDate: order.po_date, order, seller, buyer })}
                      className="flex items-center text-[11px] font-mono text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 rounded px-2 py-1">
                      <Download className="w-3 h-3 mr-1" /> PDF
                    </button>
                  </div>
                </div>
              </div>

              {/* Issue actions */}
              {showActions && (
                <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 mb-4">
                  <h4 className="text-[11px] font-mono text-gray-400 mb-3">ISSUE NEW DOCUMENT (PDF + DOCX AUTO-GENERATED)</h4>
                  {!action ? (
                    <div className="flex flex-wrap gap-2">
                      {actionDefs.map((a) => (
                        <button key={a.id} onClick={() => setAction(a.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-mono ${a.color}`}>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>{actionFields()}</div>
                      <div className="flex gap-2">
                        <button onClick={runAction} disabled={actionBusy}
                          className="flex items-center px-4 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors text-sm disabled:opacity-50">
                          {actionBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
                          {actionBusy ? 'Issuing...' : `Issue ${action}`}
                        </button>
                        <button onClick={() => { setAction(null); setActionForm({ amount: '', date: '', mode: 'NEFT', remark: '', reason: '', ref: '', orig: '' }); }}
                          className="px-4 py-2 bg-[#21262d] text-gray-300 rounded-lg hover:bg-[#30363d] text-sm">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------- main

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 animate-[fadeIn_0.15s_ease-out] overflow-y-auto">
      <div className="max-w-6xl mx-auto bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl p-6 my-6">
        <div className="flex justify-between items-center border-b border-[#21262d] pb-4 mb-5">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center"><FileText className="w-5 h-5 mr-2 text-[#f5c542]" /> Invoicing — Aracharat Ventures LLP</h2>
            <p className="text-xs text-gray-500 mt-1 font-mono">POs, bills and automatic invoice/PDF generation. SUPER_ADMIN only.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#21262d] rounded-lg text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {error && <div className="mb-4 bg-red-950/40 border border-red-900 text-red-400 rounded-lg p-3 text-sm font-mono">⚠ {error}</div>}
        {notice && <div className="mb-4 bg-emerald-950/40 border border-emerald-900 text-emerald-400 rounded-lg p-3 text-sm font-mono">✓ {notice}</div>}

        {renderTabBar()}

        {activeTab === 'bills' && (
          <div className="space-y-4">
            {renderOrderTable()}
            <p className="text-[11px] font-mono text-gray-500">Click a row to view items, payments, issued documents, and issue new bills.</p>
          </div>
        )}
        {activeTab === 'create' && renderCreateForm()}
        {activeTab === 'analytics' && <AnalyticsView orders={orders} />}
        {activeTab === 'register' && <RegisterView session={session} />}
        {activeTab === 'report' && <ReportView session={session} />}
      </div>

      {renderOrderDrawer()}
    </div>
  );
}
