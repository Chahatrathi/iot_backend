import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, RefreshCw, Cpu, Radio, Droplet, CheckCircle2, AlertTriangle,
  HelpCircle, Building2, UploadCloud
} from 'lucide-react';
import { API_BASE_URL, authFetch } from '../App';

// Fleet & Firmware panel: every device with its latest data, last-seen freshness,
// and the firmware it is actually running vs. the latest published release.
// Backend scopes PLANT_POC to their own factory; admins see everything.
export default function FleetStatus({ session, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFleet = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(session, `${API_BASE_URL}/api/firmware/fleet-status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      console.error('Fleet status fetch failed:', err);
      setError('Could not load fleet status.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { fetchFleet(); }, [fetchFleet]);

  const describeAge = (iso) => {
    if (!iso) return { text: 'never', stale: true };
    const utc = iso.endsWith('Z') ? iso : `${iso}Z`;
    const mins = Math.floor((Date.now() - new Date(utc).getTime()) / 60000);
    let text;
    if (mins < 1) text = 'just now';
    else if (mins < 60) text = `${mins} min ago`;
    else if (mins < 48 * 60) text = `${Math.floor(mins / 60)} h ${mins % 60} min ago`;
    else text = `${Math.floor(mins / 1440)} d ago`;
    return { text, stale: mins >= 30 };
  };

  const FwBadge = ({ running, deviceType }) => {
    const latest = data?.latest?.[deviceType]?.version;
    if (!latest) {
      return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-gray-800 text-gray-500 border border-gray-700">NO RELEASE</span>;
    }
    if (!running) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-gray-800 text-gray-400 border border-gray-700 inline-flex items-center">
          <HelpCircle className="w-2.5 h-2.5 mr-1" /> PRE-1.3 / UNKNOWN
        </span>
      );
    }
    if (running === latest) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-800 inline-flex items-center">
          <CheckCircle2 className="w-2.5 h-2.5 mr-1" /> UP TO DATE
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-950/60 text-amber-400 border border-amber-800 inline-flex items-center">
        <AlertTriangle className="w-2.5 h-2.5 mr-1" /> OUTDATED &rarr; v{latest}
      </span>
    );
  };

  const LastSeenCell = ({ iso }) => {
    const age = describeAge(iso);
    return <td className={`p-3 font-mono text-xs ${age.stale ? 'text-red-400' : 'text-gray-300'}`}>{age.text}</td>;
  };

  const FwCell = ({ running, deviceType }) => (
    <td className="p-3">
      <span className="font-mono text-xs text-white mr-2">{running ? `v${running}` : '—'}</span>
      <FwBadge running={running} deviceType={deviceType} />
    </td>
  );

  const SectionHeader = ({ icon: Icon, color, title, count, deviceType }) => (
    <div className="flex justify-between items-center border-b border-[#21262d] pb-2 mb-1">
      <div className={`flex items-center space-x-2 ${color}`}>
        <Icon className="w-4 h-4" />
        <h4 className="text-sm font-mono font-bold uppercase tracking-wider text-white">{title} ({count})</h4>
      </div>
      {data?.latest?.[deviceType] && (
        <span className="text-[10px] font-mono text-gray-500">
          Latest release: <span className="text-gray-300">v{data.latest[deviceType].version}</span>
        </span>
      )}
    </div>
  );

  const parseStates = (reported) => {
    // reported_states arrives as the hub sent it, e.g. "[0, 1, 0, 0, 1, 0]"
    if (!reported) return null;
    try {
      const arr = JSON.parse(reported);
      return Array.isArray(arr) ? arr : null;
    } catch { return null; }
  };

  return (
    <div className="space-y-6 font-sans text-gray-300">
      <div className="flex justify-between items-center">
        <button onClick={onBack} className="flex items-center space-x-1.5 text-sm text-gray-400 hover:text-white bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded-lg transition-colors">
          <ArrowLeft className="w-4 h-4" /><span>Back to overview</span>
        </button>
        <button onClick={fetchFleet} disabled={loading} className="flex items-center space-x-1.5 text-xs font-mono text-[#22d3ee] hover:text-cyan-300 bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded-lg transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /><span>Refresh</span>
        </button>
      </div>

      <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-5">
        <div className="flex items-center space-x-2 mb-1">
          <UploadCloud className="w-5 h-5 text-[#f5c542]" />
          <h3 className="text-base font-bold text-white">Fleet &amp; Firmware Status</h3>
        </div>
        <p className="text-[11px] font-mono text-gray-500">
          What every device is running vs. the latest published release. Hubs self-update hourly;
          relay boards update within minutes of a release reaching their hub; tank nodes on their next wake-up.
        </p>
      </div>

      {loading && !data ? (
        <div className="text-center py-12 text-sm font-mono text-gray-500 animate-pulse">SCANNING FLEET REGISTERS...</div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl text-red-400 text-sm font-mono">{error}</div>
      ) : (
        <>
          {/* CENTRAL HUBS */}
          <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-5 space-y-2">
            <SectionHeader icon={Cpu} color="text-cyan-400" title="Central Hubs" count={data.hubs.length} deviceType="CENTRAL_HUB" />
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] font-mono tracking-wider text-gray-500">
                    <th className="p-3">HUB ID</th><th className="p-3">PLANT</th><th className="p-3">LAST SEEN</th><th className="p-3">FIRMWARE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#21262d] text-sm">
                  {data.hubs.map((h) => (
                    <tr key={h.hub_id} className="hover:bg-[#1f242c] transition-colors">
                      <td className="p-3 font-mono text-xs text-white">{h.hub_id}</td>
                      <td className="p-3 text-xs text-gray-400"><span className="inline-flex items-center"><Building2 className="w-3 h-3 mr-1.5 text-[#22d3ee]" />{h.factory_name || h.factory_id || '—'}</span></td>
                      <LastSeenCell iso={h.last_seen} />
                      <FwCell running={h.firmware_version} deviceType="CENTRAL_HUB" />
                    </tr>
                  ))}
                  {data.hubs.length === 0 && <tr><td colSpan="4" className="p-3 text-xs font-mono text-gray-500 italic">No hubs provisioned.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* RELAY BOARDS */}
          <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-5 space-y-2">
            <SectionHeader icon={Radio} color="text-yellow-500" title="Relay Boards" count={data.relay_boards.length} deviceType="RELAY_BOARD" />
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] font-mono tracking-wider text-gray-500">
                    <th className="p-3">MAC</th><th className="p-3">HUB</th><th className="p-3">CHANNELS (1-6)</th><th className="p-3">LAST SEEN</th><th className="p-3">FIRMWARE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#21262d] text-sm">
                  {data.relay_boards.map((r) => {
                    const states = parseStates(r.reported_states);
                    return (
                      <tr key={r.relay_mac} className="hover:bg-[#1f242c] transition-colors">
                        <td className="p-3 font-mono text-xs text-white">{r.relay_mac}</td>
                        <td className="p-3 font-mono text-xs text-gray-400">{r.hub_id || '—'}</td>
                        <td className="p-3">
                          {states ? (
                            <div className="flex space-x-1">
                              {states.map((s, i) => (
                                <span key={i} title={`CH${i + 1}`} className={`w-4 h-4 rounded-sm text-[8px] font-mono flex items-center justify-center border ${s === 1 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-gray-800 text-gray-600 border-gray-700'}`}>{i + 1}</span>
                              ))}
                            </div>
                          ) : <span className="text-xs font-mono text-gray-600">no report yet</span>}
                        </td>
                        <LastSeenCell iso={r.last_seen} />
                        <FwCell running={r.firmware_version} deviceType="RELAY_BOARD" />
                      </tr>
                    );
                  })}
                  {data.relay_boards.length === 0 && <tr><td colSpan="5" className="p-3 text-xs font-mono text-gray-500 italic">No relay boards provisioned.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* TANK MINI NODES */}
          <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-5 space-y-2">
            <SectionHeader icon={Droplet} color="text-emerald-400" title="Tank Nodes" count={data.mini_nodes.length} deviceType="MINI_NODE" />
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] font-mono tracking-wider text-gray-500">
                    <th className="p-3">TANK</th><th className="p-3">SERIAL</th><th className="p-3">TEMP &deg;C</th><th className="p-3">MOISTURE %</th><th className="p-3">LAST READING</th><th className="p-3">FIRMWARE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#21262d] text-sm">
                  {data.mini_nodes.map((n) => (
                    <tr key={n.mininode_id} className="hover:bg-[#1f242c] transition-colors">
                      <td className="p-3 font-mono text-xs font-bold text-white">#{n.node_index || '?'}</td>
                      <td className="p-3 font-mono text-xs text-gray-400">{n.mininode_id}</td>
                      <td className="p-3 font-mono text-xs text-gray-300">{n.last_temperature != null ? Number(n.last_temperature).toFixed(1) : '—'}</td>
                      <td className="p-3 font-mono text-xs text-gray-300">{n.last_moisture != null ? Number(n.last_moisture).toFixed(1) : '—'}</td>
                      <LastSeenCell iso={n.last_reading_at || n.last_seen} />
                      <FwCell running={n.firmware_version} deviceType="MINI_NODE" />
                    </tr>
                  ))}
                  {data.mini_nodes.length === 0 && <tr><td colSpan="6" className="p-3 text-xs font-mono text-gray-500 italic">No tank nodes provisioned.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
