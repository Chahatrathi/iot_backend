import React, { useState, useEffect } from 'react';
import { 
  MapPin, Layers, Building2, Sliders, X, 
  CheckCircle, AlertCircle, UserPlus, ShieldAlert,
  Cpu, Boxes, Compass, CheckCircle2, Factory, KeyRound, Wrench, Key, Edit3, Save, Plus
} from 'lucide-react';
import { API_BASE_URL } from '../App';

export default function PlantOverview({ onSelectDevice }) {
  const [activeTab, setActiveTab] = useState('all_plants'); 
  const [fleetData, setFleetData] = useState([]);
  const [allPlants, setAllPlants] = useState([]);
  const [directoryUsers, setDirectoryUsers] = useState([]);
  const [selectedPlant, setSelectedPlant] = useState(null);
  const [loading, setLoading] = useState(true);

  // Administrative Sub-Modals Layout States
  const [activeAdminModal, setActiveAdminModal] = useState(null);
  
  // UI Panel Toggle States for team management
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState(null);

  // Hardware Node Mutation and Appending Local States
  const [editingNodeId, setEditingNodeId] = useState(null);
  const [editNodeFormId, setEditNodeFormId] = useState('');
  const [editNodeFormMac, setEditNodeFormMac] = useState('');
  const [showAddNodeForm, setShowAddNodeForm] = useState(false);
  const [additionalNodeCount, setAdditionalNodeCount] = useState('');

  // Scoped Local Plant POC Input Fields
  const [pocName, setPocName] = useState('');
  const [pocEmail, setPocEmail] = useState('');
  const [pocPassword, setPocPassword] = useState(''); 
  const [newPocPassword, setNewPocPassword] = useState('');
  const [pocRegistering, setPocRegistering] = useState(false);

  // Global Cluster Admin Addition Input States
  const [globalEmail, setGlobalEmail] = useState('');
  const [globalRole, setGlobalRole] = useState('LCB_TEAM');
  const [globalRegistering, setGlobalRegistering] = useState(false);

  // Two-Step Manual Device Hardware Input Target Arrays
  const [tankCount, setTankCount] = useState('');
  const [hubIdInput, setHubIdInput] = useState('');
  const [relayInputs, setRelayInputs] = useState([]);
  const [miniNodeInputs, setMiniNodeInputs] = useState([]);

  const [provisionManifest, setProvisionManifest] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const calculatedHubs = tankCount > 0 ? 1 : 0;
  const calculatedRelays = tankCount > 0 ? Math.ceil(parseInt(tankCount, 10) / 3) : 0;
  const calculatedMinis = tankCount > 0 ? parseInt(tankCount, 10) : 0;

  const handleTankCountChange = (val) => {
    setTankCount(val);
    setProvisionManifest(null);
    const count = parseInt(val, 10);
    
    if (isNaN(count) || count <= 0) {
      setHubIdInput('');
      setRelayInputs([]);
      setMiniNodeInputs([]);
      return;
    }

    const relaysNeeded = Math.ceil(count / 3);
    const pId = selectedPlant?.id || '0';
    
    setHubIdInput(`HUB-F${pId}-MAIN`);
    setRelayInputs(Array.from({ length: relaysNeeded }, (_, i) => `SMRTELEX-F${pId}-R${i + 1}`));
    setMiniNodeInputs(Array.from({ length: count }, (_, i) => `ESP-F${pId}-TNK${String(i + 1).padStart(2, '0')}`));
  };

  const syncData = async () => {
    setLoading(true);
    try {
      const topoRes = await fetch(`${API_BASE_URL}/api/onboard/fleet-topology`);
      if (topoRes.ok) {
        const data = await topoRes.json();
        setFleetData(data.fleet || []);
      }

      const plantsRes = await fetch(`${API_BASE_URL}/api/onboard/all-plants`);
      if (plantsRes.ok) {
        const data = await plantsRes.json();
        setAllPlants(data.plants || []);
      }

      const usersRes = await fetch(`${API_BASE_URL}/api/onboard/directory-with-plants`);
      if (usersRes.ok) {
        const data = await usersRes.json();
        setDirectoryUsers(data.users || []);
      }
    } catch (err) {
      console.error("Infrastructure synchronization failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    syncData(); 
  }, []);

  // REGISTER LOCAL SCOPED PLANT POC ACCOUNT
  const handleOnboardPlantPOC = async () => {
    if (!pocName.trim() || !pocEmail.trim() || !pocPassword.trim() || !selectedPlant) {
      alert("Validation Error: Please clear all input credential fields before executing.");
      return;
    }

    setPocRegistering(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/absolute-diagnostic-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factory_id: parseInt(selectedPlant.id, 10),
          username: pocName.trim().split('@')[0],
          email: pocEmail.trim(),
          password: pocPassword.trim(), 
          role: "PLANT_POC"
        })
      });

      if (response.ok) {
        alert(`Success: Registered ${pocName} as active PLANT_POC for ${selectedPlant.name}`);
        setPocName('');
        setPocEmail('');
        setPocPassword('');
        setShowAddForm(false);
        syncData(); 
      } else {
        const errData = await response.json();
        alert(`Account Provisioning Error: ${errData.detail || 'Execution check failure.'}`);
      }
    } catch (err) {
      console.error("POC registration pipeline broke:", err);
    } finally {
      setPocRegistering(false);
    }
  };

  // Save updated Mini-Node parameters inline targeting natural key fields
  const handleUpdateNodeDetails = async (nodeStringId) => {
    if (!editNodeFormId.trim() || !editNodeFormMac.trim()) {
      alert("Validation Error: Mini-Node tracking identifiers cannot be blank.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/onboard/update-mininode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_mininode_id: nodeStringId,
          new_mininode_id: editNodeFormId.trim(),
          relay_mac: editNodeFormMac.trim()
        })
      });

      if (response.ok) {
        alert("Success: Hardware node topology configuration synchronized perfectly.");
        setEditingNodeId(null);
        syncData();
      } else {
        alert("Operation Error: Failed to commit update pass to structural database table.");
      }
    } catch (err) {
      console.error("Hardware mutation exception:", err);
    }
  };

  // Expand node infrastructure and calculate relay changes automatically
  const handleAppendNodesToFactory = async () => {
    const nodeCountToAppend = parseInt(additionalNodeCount, 10);
    if (isNaN(nodeCountToAppend) || nodeCountToAppend <= 0) {
      alert("Input Error: Please pass a valid positive integer count configuration.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/onboard/append-hardware-nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factory_id: parseInt(selectedPlant.id, 10),
          nodes_to_add: nodeCountToAppend
        })
      });

      if (response.ok) {
        const resData = await response.json();
        alert(`Success: Deployed ${nodeCountToAppend} new telemetry mini-nodes.\nRequired Relay Boards dynamically increased by: +${resData.additional_relays_needed}`);
        setAdditionalNodeCount('');
        setShowAddNodeForm(false);
        syncData();
      } else {
        alert("Execution Pass Denied: Failed to append asset manifests.");
      }
    } catch (err) {
      console.error("Hardware extension exception runtime crash:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Add Core Global Administrator Roles
  const handleOnboardGlobalCoreRole = async () => {
    if (!globalEmail.trim()) {
      alert("Validation Error: Assignment email address cannot be left blank.");
      return;
    }

    setGlobalRegistering(true);
    try {
      const structuralUsername = globalEmail.trim().split('@')[0];
      const initialDefaultPass = "ClusterRootKey123!";

      const response = await fetch(`${API_BASE_URL}/api/absolute-diagnostic-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factory_id: null,
          username: structuralUsername,
          email: globalEmail.trim(),
          password: initialDefaultPass,
          role: globalRole
        })
      });

      if (response.ok) {
        alert(`🎉 CORE ROOT ACCOUNT PROVISIONED PERFECTLY!\n\nTemporary Starter Password: ${initialDefaultPass}`);
        setGlobalEmail('');
        setActiveAdminModal(null); 
        syncData(); 
      } else {
        const errData = await response.json();
        alert(`Global Provisioning Fault: ${errData.detail || 'Execution pass denied.'}`);
      }
    } catch (err) {
      console.error("Global infrastructure account orchestration dropped:", err);
    } finally {
      setGlobalRegistering(false);
    }
  };

  // UPDATE EXISITING PROFILE ACCESSIBILITY PASSWORDS
  const handleChangePOCPassword = async (userId) => {
    if (!newPocPassword.trim()) {
      alert("Validation Error: New password context cannot be left empty.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/onboard/update-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          new_password: newPocPassword.trim()
        })
      });

      if (response.ok) {
        alert("Success: Security credentials synchronized perfectly.");
        setNewPocPassword('');
        setEditingUserId(null);
        syncData();
      } else {
        alert("Operation Error: Failed to synchronize new key vector into table rows.");
      }
    } catch (err) {
      console.error("Password modification exception:", err);
    }
  };

  const handleExecuteProvisioning = async () => {
    if (!tankCount || tankCount <= 0 || !hubIdInput.trim() || !selectedPlant) return;
    if (relayInputs.some(r => !r.trim()) || miniNodeInputs.some(m => !m.trim())) {
      alert("Operational constraint failure: Hardware lines cannot be left blank.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/onboard/batch-provision-hardware`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factory_id: parseInt(selectedPlant.id, 10),
          tank_count: parseInt(tankCount, 10),
          hub_id: hubIdInput.trim(),
          relay_macs: relayInputs.map(r => r.trim()),
          mininode_ids: miniNodeInputs.map(m => m.trim())
        })
      });

      if (response.ok) {
        const resData = await response.json();
        setProvisionManifest(resData.manifest);
        syncData(); 
      } else {
        const errData = await response.json();
        alert(`Provisioning Error: ${errData.detail || 'Execution pass failed.'}`);
      }
    } catch (err) {
      console.error("Batch provisioning run failure:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Formats raw 8-9 digit integer nodes sequentially into clean display boxes
  const renderLiveNodeGrid = (plantNodes, plant) => {
    return plantNodes.map((node, index) => (
      <div 
        key={node.mininode_id} 
        onClick={() => { setSelectedPlant(plant); setEditingNodeId(node.mininode_id); }}
        className="bg-[#0d1117] border border-[#21262d] hover:border-cyan-400 p-3 rounded-lg text-center cursor-pointer transition-all group relative overflow-hidden"
      >
        <div className="absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-cyan-500 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
        <Factory className="w-5 h-5 mx-auto mb-1.5 text-emerald-400 group-hover:scale-110 transition-transform" />
        
        <div className="text-white font-bold font-mono text-xs tracking-wide">
          Tank #{index + 1}
        </div>
        
        <div className="text-[10px] font-mono text-gray-500 mt-1 truncate" title={`Hardware SN: ${node.mininode_id}`}>
          SN: {node.mininode_id}
        </div>
      </div>
    ));
  };

  const currentPlantPOCs = directoryUsers.filter(
    user => user.scoped_plant === selectedPlant?.name && user.role === 'PLANT_POC'
  );

  // Dynamic Relational Filter mapping back to our database schema join array outputs
  const currentPlantNodes = fleetData.filter(node => {
    if (!selectedPlant) return false;
    return parseInt(node.factory_id, 10) === parseInt(selectedPlant.id, 10);
  });

  const operationalLiveFactories = allPlants.filter(plant => plant.total_hubs > 0);

  return (
    <div className="space-y-6 font-sans text-gray-300 relative">
      
      {/* Top Operations Management Bar */}
      <div className="flex justify-between items-center bg-[#161b22] border border-[#21262d] p-4 rounded-xl">
        <div>
          <h3 className="text-sm font-mono text-gray-400">CORE INFRASTRUCTURE OPERATIONS</h3>
          <p className="text-xs text-gray-500">Secure configuration management environment</p>
        </div>
        <div className="flex space-x-2">
          <button onClick={() => setActiveAdminModal('GLOBAL_PROVISION')} className="flex items-center px-3 py-1.5 bg-[#0d1117] border border-[#21262d] hover:border-[#f5c542] rounded-lg text-xs font-mono text-gray-300 transition-all">
            <UserPlus className="w-3.5 h-3.5 mr-1.5 text-[#f5c542]" /> Provision Core Role
          </button>
          <button onClick={() => setActiveAdminModal('RBAC')} className="flex items-center px-3 py-1.5 bg-[#0d1117] border border-[#21262d] hover:border-[#22d3ee] rounded-lg text-xs font-mono text-gray-300 transition-all">
            <KeyRound className="w-3.5 h-3.5 mr-1.5 text-[#22d3ee]" /> View RBAC Matrix
          </button>
        </div>
      </div>

      {/* Navigation Tabs Layout */}
      <div className="flex space-x-2 border-b border-[#21262d] pb-px">
        <button onClick={() => setActiveTab('live')} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${activeTab === 'live' ? 'border-[#22d3ee] text-[#22d3ee]' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
          Live Activity Map ({allPlants.length})
        </button>
        <button onClick={() => setActiveTab('all_plants')} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${activeTab === 'all_plants' ? 'border-[#f5c542] text-[#f5c542]' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
          All Infrastructure Plants ({allPlants.length})
        </button>
        <button onClick={() => setActiveTab('directory')} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${activeTab === 'directory' ? 'border-amber-400 text-amber-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
          Team Access Directory ({directoryUsers.length})
        </button>
      </div>

      {loading && allPlants.length === 0 ? (
        <div className="text-center py-12 text-sm font-mono text-gray-500 animate-pulse">FETCHING CLUSTER REGISTRY DATA STREAM...</div>
      ) : activeTab === 'live' ? (
        /* WIRED UP LIVE ACTIVITY MAP TAB LAYOUT */
        <div className="space-y-6">
          {allPlants.map(plant => {
            const plantNodes = fleetData.filter(node => parseInt(node.factory_id, 10) === parseInt(plant.id, 10));

            return (
              <div key={plant.id} className="bg-[#161b22] border border-[#21262d] rounded-xl p-6 space-y-4">
                <div className="flex justify-between items-start border-b border-[#21262d]/50 pb-3">
                  <div>
                    <h4 className="text-white font-bold text-lg flex items-center">
                      <Building2 className="w-4 h-4 mr-2 text-[#22d3ee]" /> {plant.name}
                    </h4>
                    <p className="text-xs text-gray-400 flex items-center mt-1">
                      <MapPin className="w-3.5 h-3.5 mr-1 text-red-400" /> {plant.location || 'Unspecified Zone'}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-mono rounded border ${plantNodes.length > 0 ? 'bg-green-950/40 text-green-400 border-green-900' : 'bg-amber-950/40 text-amber-400 border-amber-900'}`}>
                    {plantNodes.length > 0 ? `ONLINE // ${plantNodes.length} ASSETS` : 'PROVISION MATRIX PENDING'}
                  </span>
                </div>

                {plantNodes.length === 0 ? (
                  <p className="text-xs font-mono text-gray-500 italic py-2">No active hardware identifiers broadcasting configuration indexes from this floor layout.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {renderLiveNodeGrid(plantNodes, plant)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : activeTab === 'all_plants' ? (
        <div className="bg-[#161b22] border border-[#21262d] rounded-xl overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#21262d] bg-[#0d1117] text-xs font-mono tracking-wider text-gray-400">
                <th className="p-4">PLANT PROFILE ID</th>
                <th className="p-4">FACTORY INITIAL NAME</th>
                <th className="p-4">GEOGRAPHIC ZONE LOCATION</th>
                <th className="p-4">CONNECTED NETWORK ROUTERS</th>
                <th className="p-4">INFRASTRUCTURE STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#21262d] text-sm">
              {allPlants.map((plant) => (
                <tr key={plant.id} onClick={() => { setSelectedPlant(plant); handleTankCountChange(''); setShowAddForm(false); setShowAddNodeForm(false); setEditingUserId(null); setEditingNodeId(null); }} className="hover:bg-[#1f242c] cursor-pointer transition-colors">
                  <td className="p-4 font-mono text-[#22d3ee]">#00{plant.id}</td>
                  <td className="p-4 font-semibold text-white">{plant.name}</td>
                  <td className="p-4 text-gray-400">{plant.location}</td>
                  <td className="p-4 font-mono text-gray-400">{plant.total_hubs} Hubs</td>
                  <td className="p-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono ${plant.total_hubs > 0 ? 'bg-green-950/50 text-green-400 border border-green-800' : 'bg-amber-950/50 text-[#f5c542] border border-amber-900'}`}>
                      {plant.total_hubs > 0 ? <CheckCircle className="w-3 h-3 mr-1" /> : <AlertCircle className="w-3 h-3 mr-1" />}
                      {plant.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-[#161b22] border border-[#21262d] rounded-xl overflow-hidden animate-fade-in">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#21262d] bg-[#0d1117] text-xs font-mono tracking-wider text-gray-400">
                <th className="p-4">ACCOUNT RECORD USERNAME</th>
                <th className="p-4">EMAIL ADDRESS</th>
                <th className="p-4">ROLE LEVEL</th>
                <th className="p-4">SCOPED INFRASTRUCTURE ASSIGNED</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#21262d] text-sm">
              {directoryUsers.map((user) => (
                <tr key={user.id} className="hover:bg-[#1f242c] transition-colors">
                  <td className="p-4 font-semibold text-white">{user.username}</td>
                  <td className="p-4 font-mono text-gray-400">{user.email}</td>
                  <td>
                    <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${user.role === 'SUPER_ADMIN' ? 'bg-red-950 text-red-400 border border-red-900' : user.role === 'LCB_TEAM' ? 'bg-amber-950 text-amber-400 border border-amber-900' : 'bg-blue-950 text-blue-400 border border-blue-900'}`}>{user.role}</span>
                  </td>
                  <td className="p-4 font-mono text-gray-300 flex items-center"><Building2 className="w-3.5 h-3.5 mr-2 text-[#22d3ee]" /> {user.scoped_plant}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CONTEXTUAL SIDE DRAWER VIEW */}
      {selectedPlant && (
        <div className="fixed inset-0 bg-black/70 flex justify-end z-50 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-[#161b22] h-full border-l border-[#21262d] p-6 shadow-2xl flex flex-col justify-between overflow-y-auto">
            <div className="space-y-6">
              <div className="flex justify-between items-start border-b border-[#21262d] pb-4">
                <div>
                  <span className="text-xs font-mono text-[#22d3ee]">FACTORY PROFILE OVERVIEW</span>
                  <h3 className="text-xl font-bold text-white mt-1">{selectedPlant.name}</h3>
                </div>
                <button onClick={() => setSelectedPlant(null)} className="p-1 hover:bg-[#21262d] rounded-lg text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>

              {/* Personnel Status Layer */}
              <div className="bg-[#0d1117] border border-[#21262d] p-4 rounded-xl space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <Building2 className="w-4 h-4 text-[#22d3ee]" />
                    <h4 className="text-sm font-semibold text-white">Active Factory Site Team</h4>
                  </div>
                  {!showAddForm && (
                    <button onClick={() => setShowAddForm(true)} className="text-[11px] font-mono text-black bg-[#f5c542] hover:bg-[#e0b334] px-2.5 py-1 rounded font-bold transition-colors">+ Add More POCs</button>
                  )}
                </div>

                {currentPlantPOCs.length === 0 ? (
                  <p className="text-xs font-mono text-gray-500 bg-[#161b22] p-3 rounded border border-dashed border-[#21262d] text-center">No POC accounts currently provisioned to monitor this site floor.</p>
                ) : (
                  <div className="space-y-2">
                    {currentPlantPOCs.map((user) => (
                      <div key={user.id} className="bg-[#161b22] border border-[#21262d] p-3 rounded-lg flex flex-col space-y-2">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="text-xs font-bold text-white font-sans">{user.username}</div>
                            <div className="text-[11px] font-mono text-gray-400 mt-0.5">{user.email}</div>
                          </div>
                          {editingUserId !== user.id ? (
                            <button onClick={() => { setEditingUserId(user.id); setNewPocPassword(''); }} className="text-[10px] font-mono border border-[#21262d] hover:border-[#22d3ee] hover:text-[#22d3ee] px-2 py-0.5 rounded flex items-center text-gray-400 transition-colors"><Key className="w-2.5 h-2.5 mr-1" /> Reset Key</button>
                          ) : (
                            <button onClick={() => setEditingUserId(null)} className="text-[10px] font-mono text-red-400 hover:underline">Cancel</button>
                          )}
                        </div>
                        {editingUserId === user.id && (
                          <div className="flex items-center space-x-2 pt-2 border-t border-[#21262d]">
                            <input type="password" placeholder="Enter new credential key" value={newPocPassword} onChange={(e) => setNewPocPassword(e.target.value)} className="flex-1 bg-[#0d1117] border border-[#21262d] px-2 py-1 rounded text-xs text-white focus:outline-none focus:border-[#22d3ee]" />
                            <button onClick={() => handleChangePOCPassword(user.id)} className="bg-[#22d3ee] hover:bg-cyan-500 text-black font-mono font-bold text-[11px] px-3 py-1 rounded transition-colors">Apply</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {showAddForm && (
                  <div className="border-t border-[#21262d] pt-4 mt-2 space-y-3 animate-fade-in">
                    <div className="flex justify-between items-center"><span className="text-[10px] font-mono text-gray-400 tracking-wider">NEW ACCOUNT DETAILS</span><button onClick={() => setShowAddForm(false)} className="text-[10px] font-mono text-gray-500 hover:text-white">Hide Panel</button></div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" placeholder="POC Operator Name" value={pocName} onChange={(e) => setPocName(e.target.value)} className="bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded text-xs text-white focus:outline-none focus:border-amber-400" />
                      <input type="email" placeholder="Email Address Profile" value={pocEmail} onChange={(e) => setPocEmail(e.target.value)} className="bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded text-xs text-white focus:outline-none focus:border-amber-400" />
                    </div>
                    <input type="password" placeholder="Assign Secure Password Key" value={pocPassword} onChange={(e) => setPocPassword(e.target.value)} className="w-full bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded text-xs text-white focus:outline-none focus:border-amber-400 font-mono" />
                    <button onClick={handleOnboardPlantPOC} disabled={pocRegistering} className="w-full py-1.5 bg-[#f5c542] hover:bg-[#e0b334] disabled:bg-gray-800 text-black text-xs font-mono font-bold rounded transition-colors text-center">{pocRegistering ? "CREATING POC USER..." : "EXECUTE PLANT_POC REGISTRATION"}</button>
                  </div>
                )}
              </div>

              {/* HARDWARE LAYER: Active Mini-Node Fleet Registry Matrix */}
              <div className="bg-[#0d1117] border border-[#21262d] p-4 rounded-xl space-y-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <Factory className="w-4 h-4 text-emerald-400" />
                    <h4 className="text-sm font-semibold text-white">Registered Mapped Mini-Nodes ({currentPlantNodes.length})</h4>
                  </div>
                  {!showAddNodeForm && (
                    <button onClick={() => setShowAddNodeForm(true)} className="text-[11px] font-mono text-black bg-emerald-400 hover:bg-emerald-500 px-2.5 py-1 rounded font-bold transition-colors flex items-center"><Plus className="w-3 h-3 mr-1" /> Expand Fleet</button>
                  )}
                </div>

                {showAddNodeForm && (
                  <div className="bg-[#161b22] border border-[#21262d] p-3 rounded-lg space-y-2 animate-fade-in">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-mono text-gray-400">ADDITIONAL TANK MININODES NEEDED</label>
                      <button onClick={() => setShowAddNodeForm(false)} className="text-[10px] font-mono text-gray-500 hover:text-white">Cancel</button>
                    </div>
                    <div className="flex space-x-2">
                      <input type="number" placeholder="e.g. 3" value={additionalNodeCount} onChange={(e) => setAdditionalNodeCount(e.target.value)} className="flex-1 bg-[#0d1117] border border-[#30363d] px-3 py-1.5 rounded text-xs text-white focus:outline-none focus:border-emerald-400 font-mono" />
                      <button onClick={handleAppendNodesToFactory} className="bg-emerald-400 hover:bg-emerald-500 text-black font-mono font-bold text-xs px-4 rounded transition-all">Calculate & Inject</button>
                    </div>
                  </div>
                )}

                {currentPlantNodes.length === 0 ? (
                  <p className="text-xs font-mono text-gray-500 bg-[#161b22] p-3 rounded border border-dashed border-[#21262d] text-center">No terminal nodes allocated to this factory context path yet.</p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {currentPlantNodes.map((node, index) => (
                      <div key={node.mininode_id} className="bg-[#161b22] border border-[#21262d] p-3 rounded-lg flex flex-col space-y-2 text-xs font-mono">
                        <div className="flex justify-between items-center">
                          {editingNodeId !== node.mininode_id ? (
                            <>
                              <div className="space-y-1">
                                <div className="text-white font-bold text-[12px] flex items-center">
                                  <Cpu className="w-3.5 h-3.5 mr-1.5 text-cyan-400" /> Tank #{index + 1}
                                </div>
                                <div className="text-gray-400 text-[11px] mt-0.5 flex items-center">
                                  <span className="text-gray-500 text-[9px] mr-1.5">SN: {node.mininode_id} // MAC:</span> {node.relay_mac || 'UNASSIGNED'}
                                </div>
                              </div>
                              <button onClick={() => { setEditingNodeId(node.mininode_id); setEditNodeFormId(node.mininode_id); setEditNodeFormMac(node.relay_mac || ''); }} className="border border-[#21262d] hover:border-cyan-400 text-gray-400 hover:text-cyan-400 p-1.5 rounded transition-all"><Edit3 className="w-3.5 h-3.5" /></button>
                            </>
                          ) : (
                            <div className="w-full space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[9px] text-gray-500 block mb-0.5">EDIT NODE HARDWARE ID</label>
                                  <input type="text" value={editNodeFormId} onChange={(e) => setEditNodeFormId(e.target.value)} className="w-full bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded text-white font-mono text-[11px] focus:outline-none focus:border-cyan-400" />
                                </div>
                                <div>
                                  <label className="text-[9px] text-gray-500 block mb-0.5">EDIT ACTUATOR RELAY MAC</label>
                                  <input type="text" value={editNodeFormMac} onChange={(e) => setEditNodeFormMac(e.target.value)} className="w-full bg-[#0d1117] border border-[#30363d] px-2 py-1 rounded text-white font-mono text-[11px] focus:outline-none focus:border-cyan-400" />
                                </div>
                              </div>
                              <div className="flex justify-end space-x-1 pt-1">
                                <button onClick={() => setEditingNodeId(null)} className="px-2 py-0.5 rounded border border-[#21262d] text-gray-400 text-[10px]">Cancel</button>
                                <button onClick={() => handleUpdateNodeDetails(node.mininode_id)} className="bg-cyan-400 hover:bg-cyan-500 text-black font-bold px-2 py-0.5 rounded text-[10px] flex items-center"><Save className="w-2.5 h-2.5 mr-1" /> Commit Changes</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Initial Matrix Provision Calculator fallback */}
              <div className="bg-[#0d1117] border border-[#21262d] p-5 rounded-xl space-y-4">
                <div className="flex items-center space-x-2 text-[#f5c542]"><Boxes className="w-5 h-5" /><h4 className="text-sm font-mono font-bold uppercase tracking-wider text-white">Initial Matrix Provision Calculator</h4></div>
                <div>
                  <label className="text-[10px] font-mono text-gray-500 block mb-1">TOTAL PRODUCTION TANKS ON-SITE</label>
                  <input type="number" value={tankCount} onChange={(e) => handleTankCountChange(e.target.value)} placeholder="e.g., 8" className="w-full bg-[#161b22] border border-[#21262d] px-3 py-2 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-[#f5c542]" />
                </div>
                {tankCount > 0 && !provisionManifest && (
                  <div className="grid grid-cols-3 gap-2 pt-2 text-center font-mono text-xs">
                    <div className="bg-[#161b22] border border-[#21262d] p-2 rounded-lg"><div className="text-gray-500 text-[10px]">CENTRAL HUB</div><div className="text-[#22d3ee] text-lg font-bold">{calculatedHubs}</div></div>
                    <div className="bg-[#161b22] border border-[#21262d] p-2 rounded-lg"><div className="text-gray-500 text-[10px]">RELAY BOARDS (1:3)</div><div className="text-[#f5c542] text-lg font-bold">{calculatedRelays}</div></div>
                    <div className="bg-[#161b22] border border-[#21262d] p-2 rounded-lg"><div className="text-gray-500 text-[10px]">TANK MINI-NODES</div><div className="text-emerald-400 text-lg font-bold">{calculatedMinis}</div></div>
                  </div>
                )}
              </div>

              {tankCount > 0 && !provisionManifest && (
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 text-[#22d3ee]"><Wrench className="w-4 h-4" /><h4 className="text-xs font-mono font-bold tracking-wider uppercase text-white">Input Serial ID Assignment Manifest</h4></div>
                  <div className="bg-[#0d1117] border border-[#21262d] p-4 rounded-xl space-y-2">
                    <label className="text-[10px] font-mono text-gray-400 flex items-center"><Cpu className="w-3 h-3 mr-1.5 text-[#22d3ee]" /> CENTRAL NODE GATEWAY HOST HUB ID</label>
                    <input type="text" value={hubIdInput} onChange={(e) => setHubIdInput(e.target.value)} className="w-full bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded font-mono text-xs text-white focus:outline-none" />
                  </div>
                  <div className="bg-[#0d1117] border border-[#21262d] p-4 rounded-xl space-y-3">
                    <label className="text-[10px] font-mono text-gray-400 flex items-center"><Compass className="w-3 h-3 mr-1.5 text-[#f5c542]" /> SMARTELEX ACTUATOR RELAY BOARD MACS ({calculatedRelays})</label>
                    <div className="grid grid-cols-1 gap-2">
                      {relayInputs.map((val, idx) => (
                        <div key={idx} className="flex items-center space-x-2">
                          <span className="text-[11px] font-mono text-gray-500 w-24">Relay #{idx + 1}:</span>
                          <input type="text" value={val} onChange={(e) => { const updated = [...relayInputs]; updated[idx] = e.target.value; setRelayInputs(updated); }} className="flex-1 bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded font-mono text-xs text-white focus:outline-none" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-[#0d1117] border border-[#21262d] p-4 rounded-xl space-y-3">
                    <label className="text-[10px] font-mono text-gray-400 flex items-center"><Factory className="w-3 h-3 mr-1.5 text-emerald-400" /> TANK TELEMETRY MINI-NODE HARDWARE SERIALS ({calculatedMinis})</label>
                    <div className="grid grid-cols-1 gap-2 max-h-52 overflow-y-auto pr-1">
                      {miniNodeInputs.map((val, idx) => (
                        <div key={idx} className="flex items-center space-x-2">
                          <span className="text-[11px] font-mono text-gray-500 w-24">Tank Node #{idx + 1}:</span>
                          <input type="text" value={val} onChange={(e) => { const updated = [...miniNodeInputs]; updated[idx] = e.target.value; setMiniNodeInputs(updated); }} className="flex-1 bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded font-mono text-xs text-white focus:outline-none" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <button onClick={handleExecuteProvisioning} disabled={submitting} className="w-full py-2.5 bg-[#f5c542] hover:bg-[#e0b334] text-black text-xs font-mono font-bold rounded-lg uppercase tracking-wider">{submitting ? "COMMITTING MANIFEST..." : "COMMIT & SHIP HARDWARE"}</button>
                </div>
              )}
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