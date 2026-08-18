import React, { useState } from 'react';
import { X, PlusCircle, UserPlus, Layers, ShieldCheck } from 'lucide-react';
import { API_BASE_URL, authFetch } from '../App';

export default function HardwareHubModal({ onClose, session }) {
  const [activeTab, setActiveTab] = useState('menu'); // 'menu' | 'factory' | 'user' | 'topology' | 'viewUsers'
  const [dbUsers, setDbUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  // 1. Factory Setup Form States
  const [factoryName, setFactoryName] = useState('');
  const [factoryLocation, setFactoryLocation] = useState('');

  // 2. Custom User Account Form States
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('PLANT_POC'); // Matches your updated defaults

  // 3. Hardware Mesh Topology Form States
  const [selectedFactoryId, setSelectedFactoryId] = useState('');
  const [hubId, setHubId] = useState('');
  const [relayMac, setRelayMac] = useState('');
  const [mininodeId, setMininodeId] = useState('');

  // Fetch users dynamically from your FastAPI production backend
  const fetchRegisteredUsers = async () => {
    setLoading(true);
    try {
      const response = await authFetch(session, `${API_BASE_URL}/api/users`);
      if (response.ok) {
        const data = await response.json();
        setDbUsers(data.users || []);
      }
    } catch (err) {
      console.error("Failed to sync structural user table data:", err);
    } finally {
      setLoading(false);
    }
  };

  // Submission handler for your administrative onboarding inputs
  const handleOnboardPost = async (path, bodyPayload) => {
    try {
      const response = await authFetch(session, `${API_BASE_URL}/api/onboard/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      const resData = await response.json();
      if (response.ok) {
        alert("Record provisioned and saved directly to the PostgreSQL cluster!");
        setActiveTab('menu');
        return true;
      } else {
        alert(`Provisioning Failed: ${resData.detail || 'Unknown server rejection.'}`);
        return false;
      }
    } catch (err) {
      alert(`Network connectivity break: ${err.message}`);
      return false;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-[fadeIn_0.15s_ease-out]">
      <div className="w-full max-w-2xl bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl p-6 relative max-h-[85vh] overflow-y-auto flex flex-col">
        
        {/* Modal Universal Header System */}
        <div className="flex justify-between items-center border-b border-[#21262d] pb-4 mb-4">
          <div className="flex items-center space-x-2.5">
            <ShieldCheck className="w-5 h-5 text-[#f5c542]" />
            <div>
              <h3 className="text-base font-bold text-white font-sans">Superadmin Administration System</h3>
              <p className="text-[11px] text-gray-500 font-mono">AWS RDS Cluster Orchestrator</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Dynamic Inner Component Framework Views */}
        {activeTab === 'menu' && (
          <div className="space-y-4 pt-2 font-mono text-xs">
            <h3 className="text-sm font-semibold text-gray-400 tracking-wider uppercase mb-2">Directory & Infrastructure Commands</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <button onClick={() => setActiveTab('factory')} className="p-4 bg-[#0d1117] border border-[#21262d] hover:border-[#f5c542]/40 rounded-xl text-left transition-all">
                <div className="text-white font-bold mb-1">🏢 Setup New Factory</div>
                <div className="text-gray-500 text-[11px]">Initialize physical site profile metrics.</div>
              </button>
              <button onClick={() => setActiveTab('user')} className="p-4 bg-[#0d1117] border border-[#21262d] hover:border-[#f5c542]/40 rounded-xl text-left transition-all">
                <div className="text-white font-bold mb-1">➕ Provision Team Account</div>
                <div className="text-gray-500 text-[11px]">Generate hashed credentials for LCB or POC.</div>
              </button>
              <button onClick={() => setActiveTab('topology')} className="p-4 bg-[#0d1117] border border-[#21262d] hover:border-[#f5c542]/40 rounded-xl text-left transition-all">
                <div className="text-white font-bold mb-1">⛓️ Map Mesh Topology</div>
                <div className="text-gray-500 text-[11px]">Link Hub EFuse IDs with SmartElex boards.</div>
              </button>
              <button onClick={() => { setActiveTab('viewUsers'); fetchRegisteredUsers(); }} className="p-4 bg-[#0d1117] border border-[#21262d] hover:border-[#f5c542]/40 rounded-xl text-left transition-all">
                <div className="text-white font-bold mb-1">📋 View RBAC Matrix Table</div>
                <div className="text-gray-500 text-[11px]">Verify operational table row identities.</div>
              </button>
            </div>
          </div>
        )}

        {/* VIEW 1: FACTORY CREATION MODULE */}
        {activeTab === 'factory' && (
          <form onSubmit={async (e) => { e.preventDefault(); if (await handleOnboardPost('factory', { name: factoryName, location: factoryLocation })) { setFactoryName(''); setFactoryLocation(''); } }} className="space-y-4 font-mono text-xs text-left">
            <h3 className="text-base font-bold text-white font-sans flex items-center gap-2"><PlusCircle className="text-emerald-400 w-5 h-5" /> Initialize Factory Space</h3>
            <div>
              <label className="block text-gray-400 mb-1">Plant Block Name</label>
              <input type="text" required value={factoryName} onChange={e => setFactoryName(e.target.value)} placeholder="e.g., Dehradun Production Core" className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-700 focus:outline-none focus:border-[#f5c542]" />
            </div>
            <div>
              <label className="block text-gray-400 mb-1">Geographic Location</label>
              <input type="text" required value={factoryLocation} onChange={e => setFactoryLocation(e.target.value)} placeholder="e.g., Dehradun, Uttarakhand" className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-700 focus:outline-none focus:border-[#f5c542]" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setActiveTab('menu')} className="px-4 py-2 bg-[#21262d] text-white rounded-lg">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors">Write Location to DB</button>
            </div>
          </form>
        )}

        {/* VIEW 2: TEAM ACCOUNTS PROVISIONING MODULE */}
        {activeTab === 'user' && (
          <form onSubmit={async (e) => { e.preventDefault(); if (await handleOnboardPost('user', { factory_id: 1, username: newUsername, email: newEmail, password: newPassword, role: newRole })) { setNewUsername(''); setNewEmail(''); setNewPassword(''); } }} className="space-y-4 font-mono text-xs text-left">
            <h3 className="text-base font-bold text-white font-sans flex items-center gap-2"><UserPlus className="text-blue-400 w-5 h-5" /> Create Custom Plant Account</h3>
            <div>
              <label className="block text-gray-400 mb-1">Username String</label>
              <input type="text" required value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="e.g., yash_poc" className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-700 focus:outline-none focus:border-[#f5c542]" />
            </div>
            <div>
              <label className="block text-gray-400 mb-1">Email Endpoint</label>
              <input type="email" required value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="e.g., yash@biosanjeevani.in" className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-700 focus:outline-none focus:border-[#f5c542]" />
            </div>
            <div>
              <label className="block text-gray-400 mb-1">Password Credentials</label>
              <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-700 focus:outline-none focus:border-[#f5c542]" />
            </div>
            <div>
              <label className="block text-gray-400 mb-1">Functional Security Scope Role</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-white font-bold text-[#f5c542] focus:outline-none focus:border-[#f5c542]">
                <option value="PLANT_POC">Plant_POC (Dashboard Monitoring View Only)</option>
                <option value="LCB_TEAM">LCB Team (Threshold & Parameter Override Controls)</option>
                <option value="SUPER_ADMIN">SUPER_ADMIN (Full Global Infrastructure Rights)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setActiveTab('menu')} className="px-4 py-2 bg-[#21262d] text-white rounded-lg">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors">Write User to Database</button>
            </div>
          </form>
        )}

        {/* VIEW 3: TOPOLOGY INFRASTRUCTURE MODULE */}
        {activeTab === 'topology' && (
          <form onSubmit={async (e) => { e.preventDefault(); if (await handleOnboardPost('topology', { factory_id: parseInt(selectedFactoryId), hub_id: hubId, relay_mac: relayMac, mininode_id: mininodeId, fan_channel: 1, bulb_channel: 2 })) { setHubId(''); setRelayMac(''); setMininodeId(''); } }} className="space-y-4 font-mono text-xs text-left">
            <h3 className="text-base font-bold text-white font-sans flex items-center gap-2"><Layers className="text-amber-400 w-5 h-5" /> Provision Hardware Topology</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-400 mb-1">Parent Factory ID</label>
                <input type="number" required value={selectedFactoryId} onChange={e => setSelectedFactoryId(e.target.value)} placeholder="e.g., 1" className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-white focus:outline-none focus:border-[#f5c542]" />
              </div>
              <div>
                <label className="block text-gray-400 mb-1">Central Hub Node ID</label>
                <input type="text" required value={hubId} onChange={e => setHubId(e.target.value)} placeholder="e.g., BCC32FE8CE0" className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-white focus:outline-none focus:border-[#f5c542]" />
              </div>
            </div>
            <div>
              <label className="block text-gray-400 mb-1">SmartElex Relay MAC Address</label>
              <input type="text" required value={relayMac} onChange={e => setRelayMac(e.target.value)} placeholder="e.g., BC:C3:2F:E8:CE:E0" className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-white focus:outline-none focus:border-[#f5c542]" />
            </div>
            <div>
              <label className="block text-gray-400 mb-1">Tank Mini-Node Chip ID</label>
              <input type="text" required value={mininodeId} onChange={e => setMininodeId(e.target.value)} placeholder="e.g., 1826591884" className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-lg text-white focus:outline-none focus:border-[#f5c542]" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setActiveTab('menu')} className="px-4 py-2 bg-[#21262d] text-white rounded-lg">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-500 transition-colors">Link Mesh Node Stack</button>
            </div>
          </form>
        )}

        {/* VIEW 4: RELATIONAL DIRECTORY DISPLAY MATRIX */}
        {activeTab === 'viewUsers' && (
          <div className="space-y-4 font-mono text-xs pt-2 text-left flex-grow flex flex-col min-h-0">
            <h3 className="text-base font-bold text-white font-sans">Operational Matrix Registers</h3>
            <p className="text-gray-500">Live operational accounts queried directly from AWS RDS catalogs:</p>
            
            <div className="border border-[#21262d] rounded-lg bg-[#0d1117] overflow-y-auto flex-grow max-h-[40vh]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#161b22] border-b border-[#21262d] text-gray-400 text-[10px] uppercase tracking-wider sticky top-0 z-10">
                    <th className="p-3">Username Component</th>
                    <th className="p-3">Network Identity (Email)</th>
                    <th className="p-3">Assigned Scope Role</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#21262d] text-gray-300">
                  {loading ? (
                    <tr><td colSpan="4" className="p-4 text-center text-gray-500">Querying directory tables...</td></tr>
                  ) : dbUsers.length === 0 ? (
                    <tr><td colSpan="4" className="p-4 text-center text-gray-500">No production users provisioned. Run onboarding forms.</td></tr>
                  ) : (
                    dbUsers.map(user => (
                      <tr key={user.id} className="hover:bg-[#161b22]/30 transition-colors">
                        <td className="p-3 font-semibold text-white">{user.username}</td>
                        <td className="p-3 text-gray-400 select-text">{user.email}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            user.role === 'SUPER_ADMIN' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                            user.role === 'LCB_TEAM' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                          }`}>
                            {user.role === 'LCB_TEAM' ? 'LCB TEAM' : user.role === 'PLANT_POC' ? 'PLANT POC' : user.role}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <span className="w-2 h-2 inline-block rounded-full bg-emerald-500"></span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={() => setActiveTab('menu')} className="px-4 py-2 bg-[#21262d] text-white rounded-lg hover:bg-[#30363d] transition-colors">Back to Options</button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}