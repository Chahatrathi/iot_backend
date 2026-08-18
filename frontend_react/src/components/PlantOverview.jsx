import React, { useState, useEffect } from 'react';
import { 
  MapPin, Layers, Building2, Sliders, X, 
  CheckCircle, AlertCircle, UserPlus, ShieldAlert,
  Cpu, Boxes, Compass, CheckCircle2, Factory, KeyRound, Wrench, Key, Edit3, Save, Plus,
  Clock, AlertTriangle, ArrowRight, Bell, Activity, Settings, Radio, Droplet, Wifi, WifiOff
} from 'lucide-react';
import { API_BASE_URL, authFetch } from '../App';

export default function PlantOverview({ currentUser, user, session, onSelectDevice }) {
  
  const activeUser = currentUser || user || session || {};
  const userRole = String(activeUser?.role || '').toUpperCase();
  const isAdmin = userRole === 'SUPER_ADMIN' || userRole === 'LCB_TEAM';
  const isSuperAdmin = userRole === 'SUPER_ADMIN';

  useEffect(() => {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: 'smooth' // You can change this to 'smooth' if you prefer an animated scroll
    });
  }, []);

  const [activeTab, setActiveTab] = useState('live'); 
  const [fleetData, setFleetData] = useState([]);
  const [allPlants, setAllPlants] = useState([]);
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [selectedPlant, setSelectedPlant] = useState(null);
  const [loading, setLoading] = useState(true);

  const [activeAdminModal, setActiveAdminModal] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState(null);
  const [pocName, setPocName] = useState('');
  const [pocEmail, setPocEmail] = useState('');
  const [pocPassword, setPocPassword] = useState(''); 
  const [newPocPassword, setNewPocPassword] = useState('');
  const [pocRegistering, setPocRegistering] = useState(false);
  const [globalEmail, setGlobalEmail] = useState('');
  const [globalRole, setGlobalRole] = useState('LCB_TEAM');
  const [globalRegistering, setGlobalRegistering] = useState(false);
  const [provisionManifest, setProvisionManifest] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [counts, setCounts] = useState({ hubs: 0, relays: 0, tanks: 0 });
  const [serials, setSerials] = useState({ hubs: [], relays: [], tanks: [] });

  const [pocDashboardData, setPocDashboardData] = useState({ factory: {}, fleet: [] });
  const [pocLoading, setPocLoading] = useState(true);

  // --- HARDWARE LIFECYCLE SWAP STATES ---
  const [swapActive, setSwapActive] = useState({ isOpen: false, type: '', oldId: '' });
  const [swapNewId, setSwapNewId] = useState('');
  const [isSwapping, setIsSwapping] = useState(false);

  const handleCountChange = (type, value) => {
    const count = parseInt(value, 10) || 0;
    setCounts(prev => ({ ...prev, [type]: count }));
    setProvisionManifest(null);
    setSerials(prev => {
      const newArray = Array(count).fill('');
      return {
        ...prev,
        [type]: newArray.map((_, i) => {
          if (prev[type][i]) return prev[type][i]; 
          const pId = selectedPlant?.id || '0';
          if (type === 'hubs') return `HUB-F${pId}-MAIN`;
          if (type === 'relays') return `SMRTELEX-F${pId}-R${i + 1}`;
          if (type === 'tanks') return `ESP-F${pId}-TNK${String(i + 1).padStart(2, '0')}`;
          return '';
        })
      };
    });
  };

  const handleSerialChange = (type, index, value) => {
    setSerials(prev => {
      const updatedArray = [...prev[type]];
      updatedArray[index] = value;
      return { ...prev, [type]: updatedArray };
    });
  };

  const syncAdminData = async () => {
    setLoading(true);
    try {
      const topoRes = await authFetch(session, `${API_BASE_URL}/api/onboard/fleet-topology`);
      if (topoRes.ok) { const data = await topoRes.json(); setFleetData(data.fleet || []); }

      const plantsRes = await authFetch(session, `${API_BASE_URL}/api/onboard/all-plants`);
      if (plantsRes.ok) { const data = await plantsRes.json(); setAllPlants(data.plants || []); }

      const usersRes = await authFetch(session, `${API_BASE_URL}/api/onboard/directory-with-plants`);
      if (usersRes.ok) { const data = await usersRes.json(); setDirectoryUsers(data.users || []); }
    } catch (err) {
      console.error("Infrastructure sync failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    if (!activeUser || !activeUser.role) return;

    if (isAdmin) {
      syncAdminData(); 
    } else {
      const fetchPOCData = async () => {
        try {
          const fid = activeUser.factory_id || 1;
          const response = await authFetch(session, `${API_BASE_URL}/api/onboard/poc-dashboard/${fid}`);
          if (response.ok) {
            const data = await response.json();
            setPocDashboardData(data);
          }
        } catch (err) {
          console.error("Failed to fetch POC telemetry data:", err);
        } finally {
          setPocLoading(false);
        }
      };
      fetchPOCData();
    }
  }, [activeUser.role, activeUser.factory_id, isAdmin]);

  const handleOnboardPlantPOC = async () => {
    if (!pocName.trim() || !pocEmail.trim() || !pocPassword.trim() || !selectedPlant) return;
    setPocRegistering(true);
    try {
      const response = await authFetch(session, `${API_BASE_URL}/api/absolute-diagnostic-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factory_id: parseInt(selectedPlant.id, 10), username: pocName.trim().split('@')[0], email: pocEmail.trim(), password: pocPassword.trim(), role: "PLANT_POC" })
      });
      if (response.ok) { alert(`Registered ${pocName}`); setPocName(''); setPocEmail(''); setPocPassword(''); setShowAddForm(false); syncAdminData(); }
    } catch (err) { console.error(err); } finally { setPocRegistering(false); }
  };

  const handleOnboardGlobalCoreRole = async () => {
    if (!globalEmail.trim()) return;
    setGlobalRegistering(true);
    try {
      const structuralUsername = globalEmail.trim().split('@')[0];
      const initialDefaultPass = "ClusterRootKey123!";
      const response = await authFetch(session, `${API_BASE_URL}/api/absolute-diagnostic-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factory_id: null, username: structuralUsername, email: globalEmail.trim(), password: initialDefaultPass, role: globalRole })
      });
      if (response.ok) { alert(`Account Provisioned. Password: ${initialDefaultPass}`); setGlobalEmail(''); setActiveAdminModal(null); syncAdminData(); }
    } catch (err) { console.error(err); } finally { setGlobalRegistering(false); }
  };

  const handleChangePOCPassword = async (userId) => {
    if (!newPocPassword.trim()) return;
    try {
      const response = await authFetch(session, `${API_BASE_URL}/api/onboard/update-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, new_password: newPocPassword.trim() })
      });
      if (response.ok) { setNewPocPassword(''); setEditingUserId(null); syncAdminData(); }
    } catch (err) { console.error(err); }
  };

  const handleExecuteProvisioning = async () => {
    if (!selectedPlant) return;
    const cleanHubs = serials.hubs.filter(id => id.trim() !== '');
    const cleanRelays = serials.relays.filter(mac => mac.trim() !== '');
    const cleanTanks = serials.tanks.filter(sn => sn.trim() !== '');

    if (cleanHubs.length === 0 && cleanTanks.length === 0) {
      alert("Error: You must assign at least 1 Central Hub and 1 Mini-Node to commit hardware.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await authFetch(session, `${API_BASE_URL}/api/onboard/batch-provision-hardware`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          factory_id: parseInt(selectedPlant.id, 10), 
          hub_id: cleanHubs[0] || '', 
          fan_relay_macs: cleanRelays,
          bulb_relay_macs: cleanRelays, 
          mininode_ids: cleanTanks 
        })
      });
      if (response.ok) { 
        alert("Hardware array successfully deployed to site topology registers!");
        setCounts({ hubs: 0, relays: 0, tanks: 0 });
        setSerials({ hubs: [], relays: [], tanks: [] });
        setSelectedPlant(null);
        syncAdminData(); 
      }
    } catch (err) { console.error(err); } finally { setSubmitting(false); }
  };

  const handleHardwareSwap = async () => {
    if (!swapNewId.trim()) return;
    setIsSwapping(true);
    try {
      const response = await authFetch(session, `${API_BASE_URL}/api/onboard/swap-hardware`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factory_id: parseInt(selectedPlant.id, 10),
          component_type: swapActive.type,
          old_id: swapActive.oldId,
          new_id: swapNewId.trim()
        })
      });
      if (response.ok) {
        alert(`${swapActive.type} successfully hot-swapped! Telemetry mappings updated.`);
        setSwapActive({ isOpen: false, type: '', oldId: '' });
        setSwapNewId('');
        syncAdminData(); // Refresh the topology tree
      }
    } catch (err) {
      console.error(err);
      alert("Failed to swap hardware.");
    } finally {
      setIsSwapping(false);
    }
  };

  // ============================================================================
  // CONNECTIVITY ENGINE MATH
  // ============================================================================
  const getSystemStatus = (nodes) => {
    if (!nodes || nodes.length === 0) return { status: 'PENDING', text: 'PROVISION MATRIX PENDING', color: 'text-gray-400', bg: 'bg-gray-900/50', border: 'border-gray-700', icon: <WifiOff className="w-3 h-3 mr-1" /> };

    const now = new Date();
    let latestHubTime = 0;
    let offlineNodesCount = 0;

    nodes.forEach(n => {
      const isUTCHub = n.hub_last_seen ? (n.hub_last_seen.endsWith('Z') ? n.hub_last_seen : `${n.hub_last_seen}Z`) : null;
      const hubTime = isUTCHub ? new Date(isUTCHub).getTime() : 0;
      if (hubTime > latestHubTime) latestHubTime = hubTime;

      const isUTCNode = n.node_last_seen ? (n.node_last_seen.endsWith('Z') ? n.node_last_seen : `${n.node_last_seen}Z`) : null;
      const nodeTime = isUTCNode ? new Date(isUTCNode).getTime() : 0;
      
      const nodeDiffHours = (now - nodeTime) / (1000 * 60 * 60);
      if (nodeDiffHours > 0.5 || nodeTime === 0) {
        offlineNodesCount++;
        n.is_offline = true;
      } else {
        n.is_offline = false;
      }
    });

    const hubDiffHours = latestHubTime > 0 ? (now - latestHubTime) / (1000 * 60 * 60) : Infinity;
    
    let lastSeenText = 'Never';
    if (latestHubTime > 0) {
      const d = new Date(latestHubTime);
      const datePart = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
      const timePart = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
      lastSeenText = `${datePart}, ${timePart} IST`;
    }

    if (hubDiffHours > 0.5) {
      return { 
        status: 'INTERRUPTED', text: `INTERRUPTED // HUB LOST`, subText: `Last Sync: ${lastSeenText}`,
        color: 'text-red-400', bg: 'bg-red-950/50', border: 'border-red-900', icon: <WifiOff className="w-3 h-3 mr-1" /> 
      };
    } else if (offlineNodesCount > 0) {
      return { 
        status: 'CAUTION', text: `CAUTION // ${offlineNodesCount} NODES DOWN`, subText: `Hub Sync: ${lastSeenText}`,
        color: 'text-yellow-400', bg: 'bg-yellow-950/50', border: 'border-yellow-900', icon: <AlertTriangle className="w-3 h-3 mr-1 animate-pulse" /> 
      };
    } else {
      return { 
        status: 'LIVE', text: `LIVE // ${nodes.length} ASSETS`, subText: `Last Sync: ${lastSeenText}`,
        color: 'text-emerald-400', bg: 'bg-emerald-950/50', border: 'border-emerald-900', icon: <Wifi className="w-3 h-3 mr-1" /> 
      };
    }
  };

  const renderLiveNodeGrid = (plantNodes) => {
    return plantNodes.map((node) => {
      const isOffline = node.is_offline;
      return (
        <div 
          key={node.mininode_id} 
          onClick={() => onSelectDevice(node.mininode_id)} 
          className={`bg-[#0d1117] border p-3 rounded-lg text-center cursor-pointer transition-all group relative overflow-hidden ${isOffline ? 'border-red-900/50 hover:border-red-500 shadow-[inset_0_0_15px_rgba(239,68,68,0.1)]' : 'border-[#21262d] hover:border-cyan-400'}`}
        >
          {isOffline && <div className="absolute top-0 right-0 bg-red-900/80 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-bl">OFFLINE</div>}
          <Factory className={`w-5 h-5 mx-auto mb-1.5 ${isOffline ? 'text-red-500/50' : 'text-emerald-400'}`} />
          
          {/* UPDATED: Displays the stored node_index as the Tank Number */}
          <div className={`font-bold font-mono text-xs tracking-wide ${isOffline ? 'text-gray-500' : 'text-white'}`}>
            Tank #{node.node_index || '?'}
          </div>
          
          <div className="text-[10px] font-mono text-gray-500 mt-1 truncate" title={`SN: ${node.mininode_id}`}>SN: {node.mininode_id}</div>
        </div>
      );
    });
  };

  if (!activeUser || !activeUser.role) {
    return (
      <div className="text-center py-12 text-sm font-mono text-amber-500 animate-pulse border border-amber-500/20 bg-amber-500/5 rounded-xl">
        AUTHENTICATING SESSION DATA... <br/><span className="text-xs text-gray-500 mt-2 block">(Waiting for DashboardContainer.jsx to pass session tokens)</span>
      </div>
    );
  }

  // ============================================================================
  // VIEW 1: SUPER_ADMIN & LCB_TEAM DASHBOARD (GLOBAL INFRASTRUCTURE)
  // ============================================================================
  if (isAdmin) {
    const currentPlantPOCs = directoryUsers.filter(u => u.scoped_plant === selectedPlant?.name && u.role === 'PLANT_POC');
    const currentPlantNodes = fleetData.filter(node => parseInt(node.factory_id, 10) === parseInt(selectedPlant?.id, 10));
    
    return (
      <div className="space-y-6 font-sans text-gray-300 relative">
        {isSuperAdmin && (
          <div className="flex justify-between items-center bg-[#161b22] border border-[#21262d] p-4 rounded-xl">
            <div>
              <h3 className="text-sm font-mono text-gray-400">CORE INFRASTRUCTURE OPERATIONS</h3>
              <p className="text-xs text-gray-500">Secure configuration management environment</p>
            </div>
            <div className="flex space-x-2">
              <button onClick={() => setActiveAdminModal('GLOBAL_PROVISION')} className="flex items-center px-3 py-1.5 bg-[#0d1117] border border-[#21262d] hover:border-[#f5c542] rounded-lg text-xs font-mono text-gray-300 transition-all"><UserPlus className="w-3.5 h-3.5 mr-1.5 text-[#f5c542]" /> Provision Core Role</button>
              <button onClick={() => setActiveAdminModal('RBAC')} className="flex items-center px-3 py-1.5 bg-[#0d1117] border border-[#21262d] hover:border-[#22d3ee] rounded-lg text-xs font-mono text-gray-300 transition-all"><KeyRound className="w-3.5 h-3.5 mr-1.5 text-[#22d3ee]" /> View RBAC Matrix</button>
            </div>
          </div>
        )}

        {isSuperAdmin && (
          <div className="flex space-x-2 border-b border-[#21262d] pb-px">
            <button onClick={() => setActiveTab('live')} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${activeTab === 'live' ? 'border-[#22d3ee] text-[#22d3ee]' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>Live Activity Map ({allPlants.length})</button>
            <button onClick={() => setActiveTab('all_plants')} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${activeTab === 'all_plants' ? 'border-[#f5c542] text-[#f5c542]' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>All Infrastructure Plants ({allPlants.length})</button>
            <button onClick={() => setActiveTab('directory')} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${activeTab === 'directory' ? 'border-amber-400 text-amber-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>Team Access Directory ({directoryUsers.length})</button>
          </div>
        )}

        {loading && allPlants.length === 0 ? (
          <div className="text-center py-12 text-sm font-mono text-gray-500 animate-pulse">FETCHING CLUSTER REGISTRY DATA STREAM...</div>
        ) : activeTab === 'live' ? (
          <div className="space-y-6 animate-[fadeIn_0.15s_ease-out]">
            {allPlants.map(plant => {
              const plantNodes = fleetData.filter(node => parseInt(node.factory_id, 10) === parseInt(plant.id, 10));
              const uiState = getSystemStatus(plantNodes);

              return (
                <div key={plant.id} className="bg-[#161b22] border border-[#21262d] rounded-xl p-6 space-y-4">
                  <div className="flex justify-between items-start border-b border-[#21262d]/50 pb-3">
                    <div>
                      <h4 className="text-white font-bold text-lg flex items-center"><Building2 className="w-4 h-4 mr-2 text-[#22d3ee]" /> {plant.name}</h4>
                      <p className="text-xs text-gray-400 flex items-center mt-1"><MapPin className="w-3.5 h-3.5 mr-1 text-red-400" /> {plant.location || 'Unspecified Zone'}</p>
                    </div>
                    
                    <div className="text-right">
                      <div className={`flex items-center px-2.5 py-1 text-[10px] font-mono rounded border font-bold ${uiState.bg} ${uiState.color} ${uiState.border}`}>
                        {uiState.icon} {uiState.text}
                      </div>
                      {uiState.status !== 'PENDING' && <div className="text-[9px] font-mono text-gray-500 mt-1">{uiState.subText}</div>}
                    </div>
                  </div>
                  
                  {plantNodes.length === 0 ? (
                    <p className="text-xs font-mono text-gray-500 italic py-2">No active hardware identifiers broadcasting configuration indexes from this floor layout.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">{renderLiveNodeGrid(plantNodes)}</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : activeTab === 'all_plants' ? (
          <div className="bg-[#161b22] border border-[#21262d] rounded-xl overflow-hidden animate-[fadeIn_0.15s_ease-out]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#21262d] bg-[#0d1117] text-xs font-mono tracking-wider text-gray-400">
                  <th className="p-4">PLANT PROFILE ID</th><th className="p-4">FACTORY INITIAL NAME</th><th className="p-4">GEOGRAPHIC ZONE LOCATION</th>
                  <th className="p-4">CONNECTED NETWORK ROUTERS</th><th className="p-4">INFRASTRUCTURE STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#21262d] text-sm">
                {allPlants.map((plant) => (
                  <tr key={plant.id} onClick={() => { setSelectedPlant(plant); setCounts({ hubs: 0, relays: 0, tanks: 0 }); setSerials({ hubs: [], relays: [], tanks: [] }); setShowAddForm(false); setEditingUserId(null); }} className="hover:bg-[#1f242c] cursor-pointer transition-colors">
                    <td className="p-4 font-mono text-[#22d3ee]">#00{plant.id}</td><td className="p-4 font-semibold text-white">{plant.name}</td>
                    <td className="p-4 text-gray-400">{plant.location}</td><td className="p-4 font-mono text-gray-400">{plant.total_hubs} Hubs</td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono ${plant.total_hubs > 0 ? 'bg-green-950/50 text-green-400 border border-green-800' : 'bg-amber-950/50 text-[#f5c542] border border-amber-900'}`}>
                        {plant.total_hubs > 0 ? <CheckCircle className="w-3 h-3 mr-1" /> : <AlertCircle className="w-3 h-3 mr-1" />}{plant.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-[#161b22] border border-[#21262d] rounded-xl overflow-hidden animate-[fadeIn_0.15s_ease-out]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#21262d] bg-[#0d1117] text-xs font-mono tracking-wider text-gray-400">
                  <th className="p-4">ACCOUNT RECORD USERNAME</th><th className="p-4">EMAIL ADDRESS</th><th className="p-4">ROLE LEVEL</th><th className="p-4">SCOPED INFRASTRUCTURE ASSIGNED</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#21262d] text-sm">
                {directoryUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-[#1f242c] transition-colors">
                    <td className="p-4 font-semibold text-white">{u.username}</td><td className="p-4 font-mono text-gray-400">{u.email}</td>
                    <td><span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${u.role === 'SUPER_ADMIN' ? 'bg-red-950 text-red-400 border border-red-900' : u.role === 'LCB_TEAM' ? 'bg-amber-950 text-amber-400 border border-amber-900' : 'bg-blue-950 text-blue-400 border border-blue-900'}`}>{u.role}</span></td>
                    <td className="p-4 font-mono text-gray-300 flex items-center"><Building2 className="w-3.5 h-3.5 mr-2 text-[#22d3ee]" /> {u.scoped_plant}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* --- CONTEXTUAL SLIDING PANEL DRAW SIDE DRAWER --- */}
        {selectedPlant && (
          <div className="fixed inset-0 bg-black/70 flex justify-end z-50 backdrop-blur-sm animate-[fadeIn_0.1s_ease-out]">
            <div className="w-full max-w-2xl bg-[#161b22] h-full border-l border-[#21262d] p-6 shadow-2xl flex flex-col justify-between overflow-y-auto custom-scrollbar">
              <div className="space-y-6">
                <div className="flex justify-between items-start border-b border-[#21262d] pb-4">
                  <div><span className="text-xs font-mono text-[#22d3ee]">FACTORY PROFILE OVERVIEW</span><h3 className="text-xl font-bold text-white mt-1">{selectedPlant.name}</h3></div>
                  <button onClick={() => setSelectedPlant(null)} className="p-1 hover:bg-[#21262d] rounded-lg text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>

                <div className="bg-[#0d1117] border border-[#21262d] p-4 rounded-xl space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-2"><Building2 className="w-4 h-4 text-[#22d3ee]" /><h4 className="text-sm font-semibold text-white">Active Factory Site Team</h4></div>
                    {!showAddForm && <button onClick={() => setShowAddForm(true)} className="text-[11px] font-mono text-black bg-[#f5c542] hover:bg-[#e0b334] px-2.5 py-1 rounded font-bold transition-colors">+ Add More POCs</button>}
                  </div>
                  {currentPlantPOCs.length === 0 ? (
                    <p className="text-xs font-mono text-gray-500 bg-[#161b22] p-3 rounded border border-dashed border-[#21262d] text-center">No POC accounts currently provisioned to monitor this site floor.</p>
                  ) : (
                    <div className="space-y-2">
                      {currentPlantPOCs.map((u) => (
                        <div key={u.id} className="bg-[#161b22] border border-[#21262d] p-3 rounded-lg flex flex-col space-y-2">
                          <div className="flex justify-between items-start">
                            <div><div className="text-xs font-bold text-white font-sans">{u.username}</div><div className="text-[11px] font-mono text-gray-400 mt-0.5">{u.email}</div></div>
                            {editingUserId !== u.id ? (
                              <button onClick={() => { setEditingUserId(u.id); setNewPocPassword(''); }} className="text-[10px] font-mono border border-[#21262d] hover:border-[#22d3ee] hover:text-[#22d3ee] px-2 py-0.5 rounded flex items-center text-gray-400 transition-colors"><Key className="w-2.5 h-2.5 mr-1" /> Reset Key</button>
                            ) : (
                              <button onClick={() => setEditingUserId(null)} className="text-[10px] font-mono text-red-400 hover:underline">Cancel</button>
                            )}
                          </div>
                          {editingUserId === u.id && (
                            <div className="flex items-center space-x-2 pt-2 border-t border-[#21262d]">
                              <input type="password" placeholder="Enter new credential key" value={newPocPassword} onChange={(e) => setNewPocPassword(e.target.value)} className="flex-1 bg-[#0d1117] border border-[#21262d] px-2 py-1 rounded text-xs text-white focus:outline-none" />
                              <button onClick={() => handleChangePOCPassword(u.id)} className="bg-[#22d3ee] hover:bg-cyan-500 text-black font-mono font-bold text-[11px] px-3 py-1 rounded transition-colors">Apply</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* --- ACTIVE HARDWARE TOPOLOGY MAP --- */}
                  <div className="bg-[#0d1117] border border-[#21262d] p-5 rounded-xl space-y-4 mt-6">
                    <div className="flex items-center space-x-2 text-[#22d3ee]">
                      <Layers className="w-5 h-5" />
                      <h4 className="text-sm font-mono font-bold uppercase tracking-wider text-white">Active Hardware Topology</h4>
                    </div>
                    
                    {currentPlantNodes.length === 0 ? (
                      <p className="text-xs font-mono text-gray-500 bg-[#161b22] p-3 rounded border border-dashed border-[#21262d] text-center">
                        No topology matrix found. Provision hardware below.
                      </p>
                    ) : (
                      <div className="space-y-4 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
                        {/* Group Nodes by Hub */}
                        {Object.entries(
                          currentPlantNodes.reduce((acc, node) => {
                            const hub = node.hub_id || 'UNASSIGNED_HUB';
                            acc[hub] = acc[hub] || [];
                            acc[hub].push(node);
                            return acc;
                          }, {})
                        ).map(([hubId, nodes]) => (
                          <div key={hubId} className="bg-[#161b22] border border-[#21262d] rounded-lg overflow-hidden">
                            {/* Hub Header */}
                            <div className="bg-[#1f242c] p-3 flex justify-between items-center border-b border-[#21262d]">
                              <div className="flex items-center space-x-2">
                                <Cpu className="w-4 h-4 text-cyan-400" />
                                <span className="text-xs font-mono font-bold text-white tracking-wide">HUB: {hubId}</span>
                              </div>
                              <button onClick={() => setSwapActive({ isOpen: true, type: 'CENTRAL_HUB', oldId: hubId })} className="text-[10px] font-mono text-[#f5c542] hover:underline flex items-center">
                                <Wrench className="w-3 h-3 mr-1" /> Swap
                              </button>
                            </div>

                            {/* Mini Nodes attached to this Hub */}
                            <div className="p-3 space-y-3">
                              {nodes.map((node, idx) => (
                                <div key={node.mininode_id} className="border border-[#30363d] rounded bg-[#0d1117] p-3 relative">
                                  <div className="flex justify-between items-start mb-2">
                                    <div>
                                      <span className="text-[10px] font-mono text-emerald-400 font-bold tracking-wider">TANK NODE #{idx + 1}</span>
                                      <div className="text-xs font-mono text-white mt-0.5">{node.mininode_id}</div>
                                    </div>
                                    <button onClick={() => setSwapActive({ isOpen: true, type: 'MINI_NODE', oldId: node.mininode_id })} className="text-[10px] font-mono text-[#f5c542] hover:underline flex items-center">
                                      <Wrench className="w-3 h-3 mr-1" /> Swap Node
                                    </button>
                                  </div>
                                  
                                  {/* --- NEW RELAY MAPPING MATRIX WITH GLOWING BADGES --- */}
                                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-[#21262d] pt-2">
                                    
                                    {/* EXHAUST FAN CARD */}
                                    <div className="bg-[#161b22] p-3 rounded-lg text-[10px] font-mono border border-[#30363d]/50 relative overflow-hidden transition-all">
                                      <div className="absolute top-2 right-2">
                                        {node.fan_status === 1 ? (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                                            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full mr-1.5 animate-pulse"></span> ON
                                          </span>
                                        ) : (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-800 text-gray-500 border border-gray-700 flex items-center">
                                            <span className="w-1.5 h-1.5 bg-gray-600 rounded-full mr-1.5"></span> OFF
                                          </span>
                                        )}
                                      </div>

                                      <span className="text-gray-500 block mb-1.5 font-sans font-bold text-[11px]">EXHAUST FAN ACTUATOR</span>
                                      <div className="text-gray-300 mb-0.5">MAC: <span className="text-cyan-400">{node.fan_relay_mac || 'UNASSIGNED'}</span></div>
                                      <div className="text-gray-300">PIN: <span className="text-yellow-500">CH-{node.fan_channel || '?'}</span></div>
                                      
                                      {node.fan_relay_mac && (
                                        <button onClick={() => setSwapActive({ isOpen: true, type: 'RELAY_BOARD', oldId: node.fan_relay_mac })} className="mt-2 text-gray-500 hover:text-[#f5c542] hover:underline flex items-center">
                                          Swap Board
                                        </button>
                                      )}
                                    </div>

                                    {/* HEATER BULB CARD */}
                                    <div className="bg-[#161b22] p-3 rounded-lg text-[10px] font-mono border border-[#30363d]/50 relative overflow-hidden transition-all">
                                      <div className="absolute top-2 right-2">
                                        {node.bulb_status === 1 ? (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center shadow-[0_0_8px_rgba(168,85,247,0.3)]">
                                            <span className="w-1.5 h-1.5 bg-purple-400 rounded-full mr-1.5 animate-pulse"></span> ON
                                          </span>
                                        ) : (
                                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-800 text-gray-500 border border-gray-700 flex items-center">
                                            <span className="w-1.5 h-1.5 bg-gray-600 rounded-full mr-1.5"></span> OFF
                                          </span>
                                        )}
                                      </div>

                                      <span className="text-gray-500 block mb-1.5 font-sans font-bold text-[11px]">HEATER BULB ACTUATOR</span>
                                      <div className="text-gray-300 mb-0.5">MAC: <span className="text-purple-400">{node.bulb_relay_mac || 'UNASSIGNED'}</span></div>
                                      <div className="text-gray-300">PIN: <span className="text-yellow-500">CH-{node.bulb_channel || '?'}</span></div>
                                      
                                      {node.bulb_relay_mac && (
                                        <button onClick={() => setSwapActive({ isOpen: true, type: 'RELAY_BOARD', oldId: node.bulb_relay_mac })} className="mt-2 text-gray-500 hover:text-[#f5c542] hover:underline flex items-center">
                                          Swap Board
                                        </button>
                                      )}
                                    </div>

                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Inline Swap Modal Triggered by buttons above */}
                    {swapActive.isOpen && (
                      <div className="mt-4 p-4 border border-[#f5c542]/50 bg-[#f5c542]/10 rounded-lg animate-fade-in space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-mono font-bold text-[#f5c542]">HARDWARE HOT-SWAP MODE</span>
                          <button onClick={() => { setSwapActive({ isOpen: false, type: '', oldId: '' }); setSwapNewId(''); }} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="text-[10px] font-mono text-gray-400">
                          Replacing {swapActive.type.replace('_', ' ')}: <span className="text-white bg-[#0d1117] px-1 rounded">{swapActive.oldId}</span>
                        </div>
                        <input 
                          type="text" 
                          placeholder="Scan or Type New Serial/MAC Identifier" 
                          value={swapNewId} 
                          onChange={(e) => setSwapNewId(e.target.value)} 
                          className="w-full bg-[#161b22] border border-[#21262d] px-3 py-2 rounded text-xs text-white focus:outline-none focus:border-[#f5c542] font-mono" 
                        />
                        <button 
                          onClick={handleHardwareSwap} 
                          disabled={isSwapping} 
                          className="w-full py-2 bg-[#f5c542] hover:bg-[#e0b334] disabled:bg-gray-800 text-black text-xs font-mono font-bold rounded transition-colors"
                        >
                          {isSwapping ? "MIGRATING TELEMETRY..." : "CONFIRM REPLACEMENT & MIGRATE"}
                        </button>
                      </div>
                    )}
                  </div>

                  {showAddForm && (
                    <div className="border-t border-[#21262d] pt-4 mt-2 space-y-3 animate-fade-in">
                      <div className="flex justify-between items-center"><span className="text-[10px] font-mono text-gray-400 tracking-wider">NEW ACCOUNT DETAILS</span><button onClick={() => setShowAddForm(false)} className="text-[10px] font-mono text-gray-500 hover:text-white">Hide Panel</button></div>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" placeholder="POC Operator Name" value={pocName} onChange={(e) => setPocName(e.target.value)} className="bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded text-xs text-white focus:outline-none" />
                        <input type="email" placeholder="Email Address Profile" value={pocEmail} onChange={(e) => setPocEmail(e.target.value)} className="bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded text-xs text-white focus:outline-none" />
                      </div>
                      <input type="password" placeholder="Assign Secure Password Key" value={pocPassword} onChange={(e) => setPocPassword(e.target.value)} className="w-full bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded text-xs text-white focus:outline-none font-mono" />
                      <button onClick={handleOnboardPlantPOC} disabled={pocRegistering} className="w-full py-1.5 bg-[#f5c542] hover:bg-[#e0b334] disabled:bg-gray-800 text-black text-xs font-mono font-bold rounded transition-colors text-center">{pocRegistering ? "CREATING POC USER..." : "EXECUTE PLANT_POC REGISTRATION"}</button>
                    </div>
                  )}
                </div>

                <div className="bg-[#0d1117] border border-[#21262d] p-5 rounded-xl space-y-4">
                  <div className="flex items-center space-x-2 text-yellow-500">
                    <Boxes className="w-5 h-5" />
                    <h4 className="text-sm font-mono font-bold uppercase tracking-wider text-white">Custom Matrix Provision Calculator</h4>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-[#161b22] p-3 rounded border border-[#21262d]">
                      <label className="block text-gray-400 text-[10px] mb-1 font-mono uppercase">Central Hubs</label>
                      <input type="number" min="0" value={counts.hubs} onChange={(e) => handleCountChange('hubs', e.target.value)} className="w-full bg-transparent border border-gray-700 rounded p-1 text-white outline-none focus:border-cyan-500 font-mono text-xs" />
                    </div>
                    <div className="bg-[#161b22] p-3 rounded border border-[#21262d]">
                      <label className="block text-gray-400 text-[10px] mb-1 font-mono uppercase">Relay Boards</label>
                      <input type="number" min="0" value={counts.relays} onChange={(e) => handleCountChange('relays', e.target.value)} className="w-full bg-transparent border border-gray-700 rounded p-1 text-white outline-none focus:border-cyan-500 font-mono text-xs" />
                    </div>
                    <div className="bg-[#161b22] p-3 rounded border border-[#21262d]">
                      <label className="block text-gray-400 text-[10px] mb-1 font-mono uppercase">Tank Nodes</label>
                      <input type="number" min="0" value={counts.tanks} onChange={(e) => handleCountChange('tanks', e.target.value)} className="w-full bg-transparent border border-gray-700 rounded p-1 text-white outline-none focus:border-cyan-500 font-mono text-xs" />
                    </div>
                  </div>

                  {(counts.hubs > 0 || counts.relays > 0 || counts.tanks > 0) && (
                    <div className="space-y-4 pt-2 animate-fade-in">
                      <div className="flex items-center space-x-2 text-cyan-400 border-b border-gray-800 pb-1.5">
                        <Wrench className="w-4 h-4" />
                        <h4 className="text-xs font-mono font-bold tracking-wider uppercase text-white">Input Serial ID Assignment Manifest</h4>
                      </div>

                      {counts.hubs > 0 && (
                        <div className="space-y-2 bg-[#161b22] border border-[#21262d] p-3 rounded-lg">
                          <label className="text-[10px] font-mono text-cyan-400 flex items-center"><Cpu className="w-3 h-3 mr-1.5" /> Central Hub Router ID Manifest ({counts.hubs})</label>
                          {serials.hubs.map((serial, idx) => (
                            <div key={`hub-${idx}`} className="flex items-center space-x-2">
                              <span className="text-gray-500 font-mono text-[11px] w-16">Hub #{idx + 1}:</span>
                              <input type="text" value={serial} onChange={(e) => handleSerialChange('hubs', idx, e.target.value)} className="flex-1 bg-[#0d1117] border border-gray-700 rounded p-1.5 text-white font-mono text-xs outline-none" />
                            </div>
                          ))}
                        </div>
                      )}

                      {counts.relays > 0 && (
                        <div className="space-y-2 bg-[#161b22] border border-[#21262d] p-3 rounded-lg">
                          <label className="text-[10px] font-mono text-yellow-500 flex items-center"><Radio className="w-3 h-3 mr-1.5" /> Smartelex Relay MAC Manifest ({counts.relays})</label>
                          {serials.relays.map((serial, idx) => (
                            <div key={`relay-${idx}`} className="flex items-center space-x-2">
                              <span className="text-gray-500 font-mono text-[11px] w-16">Relay #{idx + 1}:</span>
                              <input type="text" value={serial} onChange={(e) => handleSerialChange('relays', idx, e.target.value)} className="flex-1 bg-[#0d1117] border border-gray-700 rounded p-1.5 text-white font-mono text-xs outline-none" />
                            </div>
                          ))}
                        </div>
                      )}

                      {counts.tanks > 0 && (
                        <div className="space-y-2 bg-[#161b22] border border-[#21262d] p-3 rounded-lg">
                          <label className="text-[10px] font-mono text-green-400 flex items-center"><Droplet className="w-3 h-3 mr-1.5" /> Tank Mini-Node Serial Tracker Manifest ({counts.tanks})</label>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {serials.tanks.map((serial, idx) => (
                              <div key={`tank-${idx}`} className="flex items-center space-x-2">
                                <span className="text-gray-500 font-mono text-[11px] w-16">Tank #{idx + 1}:</span>
                                <input type="text" value={serial} onChange={(e) => handleSerialChange('tanks', idx, e.target.value)} className="flex-1 bg-[#0d1117] border border-gray-700 rounded p-1.5 text-white font-mono text-xs outline-none" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button onClick={handleExecuteProvisioning} disabled={submitting} className="w-full py-2.5 bg-[#f5c542] hover:bg-[#e0b334] disabled:bg-gray-800 text-black text-xs font-mono font-bold rounded-lg uppercase tracking-wider transition-colors">
                        {submitting ? "COMMITTING MANIFEST..." : "COMMIT & SHIP HARDWARE"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="border-t border-[#21262d] pt-4 mt-6"><button onClick={() => setSelectedPlant(null)} className="w-full py-2 bg-[#21262d] hover:bg-[#30363d] text-sm font-medium text-white rounded-lg">Close Layout View</button></div>
            </div>
          </div>
        )}

        {/* 🔐 MODAL: Audit View */}
        {activeAdminModal === 'RBAC' && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-2xl bg-[#161b22] border border-[#21262d] rounded-xl p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-center border-b border-[#21262d] pb-3">
                <div className="flex items-center space-x-2"><KeyRound className="w-5 h-5 text-[#22d3ee]" /><h3 className="text-lg font-bold text-white">System RBAC Matrix Audit</h3></div>
                <button onClick={() => setActiveAdminModal(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="bg-[#0d1117] border border-[#21262d] rounded-lg overflow-hidden text-xs font-mono">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[#161b22] border-b border-[#21262d] text-gray-400"><th className="p-3">ROLE SYSTEM IDENTITY</th><th className="p-3">FLEET READ</th><th className="p-3">MESH WRITE</th><th className="p-3">USER PROVISION</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[#21262d] text-gray-300">
                    <tr><td className="p-3 text-red-400 font-bold">SUPER_ADMIN</td><td className="p-3 text-green-400">ALLOWED</td><td className="p-3 text-green-400">ALLOWED</td><td className="p-3 text-green-400">GLOBAL/LOCAL</td></tr>
                    <tr><td className="p-3 text-amber-400 font-bold">LCB_TEAM</td><td className="p-3 text-green-400">ALLOWED</td><td className="p-3 text-green-400">ALLOWED</td><td className="p-3 text-red-500">DENIED</td></tr>
                    <tr><td className="p-3 text-blue-400 font-bold">PLANT_POC</td><td className="p-3 text-gray-400">LOCAL ONLY</td><td className="p-3 text-red-500">DENIED</td><td className="p-3 text-red-500">DENIED</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 🏗️ MODAL: Global Core Account Provision */}
        {activeAdminModal === 'GLOBAL_PROVISION' && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md bg-[#161b22] border border-[#21262d] rounded-xl p-6 shadow-2xl space-y-4 animate-fade-in">
              <div className="flex justify-between items-center border-b border-[#21262d] pb-3">
                <div className="flex items-center space-x-2"><ShieldAlert className="w-5 h-5 text-[#f5c542]" /><h3 className="text-lg font-bold text-white">Provision Cluster Root Core Account</h3></div>
                <button onClick={() => setActiveAdminModal(null)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-mono text-gray-400 block mb-1">TARGET INFRASTRUCTURE ROLE</label>
                  <select value={globalRole} onChange={(e) => setGlobalRole(e.target.value)} className="w-full bg-[#0d1117] border border-[#21262d] p-2 rounded text-xs text-white font-mono focus:outline-none">
                    <option value="LCB_TEAM">LCB_TEAM (Core Operator)</option>
                    <option value="SUPER_ADMIN">SUPER_ADMIN (Full Cluster Orchestrator)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-mono text-gray-400 block mb-1">CREDENTIAL ASSIGNMENT EMAIL</label>
                  <input type="email" placeholder="operator@system.com" value={globalEmail} onChange={(e) => setGlobalEmail(e.target.value)} className="w-full bg-[#0d1117] border border-[#21262d] p-2 rounded text-xs text-white focus:outline-none" />
                </div>
                <button onClick={handleOnboardGlobalCoreRole} disabled={globalRegistering} className="w-full py-2 bg-[#f5c542] hover:bg-[#e0b334] text-black text-xs font-mono font-bold rounded-lg transition-colors text-center">{globalRegistering ? "PROVISIONING ROOT OPERATOR..." : "COMMIT MASTER SYSTEM CREDENTIALS"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // VIEW 2: LOCAL PLANT_POC DASHBOARD (RENDERS ONLY IF isAdmin IS FALSE)
  // ============================================================================
  if (pocLoading) {
    return <div className="text-center py-12 text-sm font-mono text-gray-500 animate-pulse">SYNCING PLANT TELEMETRY...</div>;
  }

  const { factory, fleet } = pocDashboardData;
  // FORCE SORTING BY node_index SO TANK #1 IS ALWAYS FIRST
  const fleetDataForPOC = (pocDashboardData.fleet || []).sort((a, b) => a.node_index - b.node_index);
  const plantName = factory?.name || "Assigned Facility";
  const plantLocation = factory?.location || "Local Zone";
  const uiState = getSystemStatus(fleetDataForPOC);

  return (
    <div className="space-y-6 font-sans text-gray-300">
      
      {!activeUser.factory_id && (
        <div className="bg-red-500/10 border border-red-500/50 p-4 rounded-xl text-red-400 text-sm font-mono flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <strong className="block mb-1">Configuration Error:</strong> 
            No Factory ID is linked to your session. Please ensure your parent component is passing the user's <code className="bg-red-950 px-1 py-0.5 rounded">factory_id</code>.
          </div>
        </div>
      )}

      {/* Factory Grid Header and Map */}
      <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-6 space-y-4">
        <div className="flex justify-between items-start border-b border-[#21262d]/50 pb-3">
          <div>
            <h4 className="text-white font-bold text-lg flex items-center">
              <Building2 className="w-5 h-5 mr-2 text-[#22d3ee]" /> {plantName}
            </h4>
            <p className="text-xs text-gray-400 flex items-center mt-1.5">
              <MapPin className="w-3.5 h-3.5 mr-1 text-red-400" /> {plantLocation}
            </p>
          </div>

          <div className="text-right">
            <div className={`flex items-center px-2.5 py-1 text-[10px] font-mono rounded border font-bold ${uiState.bg} ${uiState.color} ${uiState.border}`}>
              {uiState.icon} {uiState.text}
            </div>
            {uiState.status !== 'PENDING' && <div className="text-[9px] font-mono text-gray-500 mt-1">{uiState.subText}</div>}
          </div>
        </div>

        {fleetDataForPOC?.length === 0 ? (
          <p className="text-xs font-mono text-gray-500 italic py-2">No active hardware identifiers broadcasting configuration indexes from this floor layout.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {/* Pass the sorted fleetDataForPOC here */}
            {renderLiveNodeGrid(fleetDataForPOC)}
          </div>
        )}
      </div>

      {/* Live Notification Channel Section */}
      <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-5">
        <div className="flex items-center space-x-2 border-b border-[#21262d]/50 pb-3 mb-3">
          <Bell className="w-4 h-4 text-[#f5c542]" />
          <h4 className="text-sm font-bold text-white uppercase tracking-wider font-mono">Notification Channel</h4>
        </div>
        
        <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
          {uiState.status === 'INTERRUPTED' && (
            <div className="bg-[#0d1117] border border-red-900/50 p-3 rounded-lg flex items-start space-x-3">
              <div className="mt-0.5"><WifiOff className="w-4 h-4 text-red-500" /></div>
              <div>
                <div className="text-xs font-bold text-red-400">CRITICAL: Central Hub Disconnected</div>
                <div className="text-[10px] text-gray-500 mt-0.5">The central WiFi router has failed to ping the cloud for over 30 minute. Please physically inspect the power line to the main hub.</div>
              </div>
            </div>
          )}

          {uiState.status === 'CAUTION' && (
            <div className="bg-[#0d1117] border border-yellow-900/50 p-3 rounded-lg flex items-start space-x-3">
              <div className="mt-0.5"><AlertTriangle className="w-4 h-4 text-yellow-400" /></div>
              <div>
                <div className="text-xs font-bold text-yellow-400">WARNING: Mini-Nodes Offline</div>
                <div className="text-[10px] text-gray-500 mt-0.5">The central hub is online, but one or more tank nodes have failed to transmit data for over 30 minutes. Check batteries or mesh range.</div>
              </div>
            </div>
          )}

          <div className="bg-[#0d1117] border border-[#21262d] p-3 rounded-lg flex items-start space-x-3">
            <div className="mt-0.5"><CheckCircle className="w-4 h-4 text-emerald-400" /></div>
            <div>
              <div className="text-xs font-bold text-gray-300">Telemetry Sync Initialized</div>
              <div className="text-[10px] text-gray-500 mt-0.5">System has successfully connected to {fleet?.length || 0} active nodes on the facility floor. Data streaming is live.</div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}