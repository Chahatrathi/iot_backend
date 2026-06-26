import React, { useState, useEffect } from 'react';
import { 
  ArrowLeft, Thermometer, Droplet, Sliders, Clock, 
  Power, Package, Activity, ShieldAlert, Settings, Edit3, Save, X, CheckCircle2,
  AlertTriangle, Wifi, WifiOff, CalendarDays, Sprout
} from 'lucide-react';
import { Line } from 'react-chartjs-2';
import { 
  Chart as ChartJS, CategoryScale, LinearScale, 
  PointElement, LineElement, Tooltip, Legend, ScatterController
} from 'chart.js';
import { API_BASE_URL } from '../App';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, ScatterController);

export default function DeviceTelemetry({ session, deviceId, onBack }) {
  
  // 1. DETERMINE USER ROLE
  const userRole = session?.role?.toUpperCase() || 'PLANT_POC';
  const isAdmin = userRole === 'SUPER_ADMIN' || userRole === 'LCB_TEAM';
  const isSuperAdmin = userRole === 'SUPER_ADMIN'; // <-- ADDED FOR STRICTER ACCESS CONTROL

  const [deviceData, setDeviceData] = useState({ config: null, history: [], master_off_events: [] });
  const [loading, setLoading] = useState(true);
  const [halting, setHalting] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [timeRange, setTimeRange] = useState(24);

  // ==========================================
  // EDIT CONFIGURATION STATES
  // ==========================================
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configForm, setConfigForm] = useState({
    interval: 15, tempMin: 20, tempMax: 35, moistMin: 40, moistMax: 60
  });

  // ==========================================
  // WIZARD SWEEPER STRUCTURAL STATES
  // ==========================================
  const [showWizard, setShowWizard] = useState(false);
  const [availableRelays, setAvailableRelays] = useState([]);
  const [currentRelayIdx, setCurrentRelayIdx] = useState(0);
  const [currentChannel, setCurrentChannel] = useState(1);
  const [testingActive, setTestingActive] = useState(false);

  const [discoveredFanMap, setDiscoveredFanMap] = useState(null); 
  const [discoveredBulbMap, setDiscoveredBulbMap] = useState(null); 

  // ==========================================
  // DATA INGESTION
  // ==========================================
  const fetchDeviceData = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/telemetry/device/${deviceId}?hours=${timeRange}`);
      if (response.ok) {
        const data = await response.json();
        setDeviceData({ config: data.config, history: data.history, master_off_events: data.master_off_events || [] });
        setAvailableRelays(data.available_relays || []);
      }
    } catch (error) {
      console.error("Failed to fetch device telemetry:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeviceData();
    const interval = setInterval(fetchDeviceData, 30000);
    return () => clearInterval(interval);
  }, [deviceId, timeRange]);

  // ==========================================
  // CONFIGURATION EDITOR HANDLERS
  // ==========================================
  const handleEditConfigToggle = () => {
    if (!deviceData.config) return;
    setConfigForm({
      interval: deviceData.config.telemetry_interval_ms ? (deviceData.config.telemetry_interval_ms / 60000) : 15,
      tempMin: deviceData.config.temp_min || 20,
      tempMax: deviceData.config.temp_max || 35,
      moistMin: deviceData.config.moisture_min || 40,
      moistMax: deviceData.config.moisture_max || 60
    });
    setIsEditingConfig(true);
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/telemetry/device/${deviceId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          temp_min: parseFloat(configForm.tempMin),
          temp_max: parseFloat(configForm.tempMax),
          moisture_min: parseFloat(configForm.moistMin),
          moisture_max: parseFloat(configForm.moistMax),
          telemetry_interval_ms: parseInt(configForm.interval, 10) * 60000
        })
      });

      if (response.ok) {
        alert("Configuration updated successfully! The ESP32 will pick up these changes on its next ping.");
        setIsEditingConfig(false);
        fetchDeviceData(); 
      } else {
        alert("Failed to update threshold parameters.");
      }
    } catch (err) {
      console.error(err);
      alert("Network Error: Could not save configuration.");
    } finally {
      setSavingConfig(false);
    }
  };

  // ==========================================
  // SWEEPER ENGINE LOGIC
  // ==========================================
  const triggerSweepPulse = async (state) => {
    const targetRelay = availableRelays[currentRelayIdx];
    if (!targetRelay) return;

    setTestingActive(true);
    try {
      await fetch(`${API_BASE_URL}/api/telemetry/device/diagnostic-pulse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relay_mac: targetRelay, hub_id: deviceData.config?.hub_id || 'HUB-F1-MAIN', channel: currentChannel, state: state })
      });
    } catch (err) { console.error(err); } finally { setTestingActive(false); }
  };

  const advanceSweepStep = (selectionType) => {
    const targetRelay = availableRelays[currentRelayIdx];
    triggerSweepPulse(0);

    if (selectionType === 'FAN') setDiscoveredFanMap({ relay: targetRelay, channel: currentChannel });
    else if (selectionType === 'BULB') setDiscoveredBulbMap({ relay: targetRelay, channel: currentChannel });

    if (currentChannel < 6) {
      setCurrentChannel(prev => prev + 1);
    } else {
      if (currentRelayIdx + 1 < availableRelays.length) {
        setCurrentRelayIdx(prev => prev + 1);
        setCurrentChannel(1);
      } else {
        alert("🏁 Plant Hardware Sweep Sequence Finished! Please review and save configuration logs.");
      }
    }
  };

  const handleFinalSave = async () => {
    if (!discoveredFanMap || !discoveredBulbMap) {
      alert("Error: You must assign both an Exhaust Fan and a Heating Bulb before saving mapping matrices.");
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/telemetry/device/bind-confirmed-ports`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mininode_id: deviceId,
          fan_relay_mac: discoveredFanMap.relay, fan_channel: discoveredFanMap.channel,
          bulb_relay_mac: discoveredBulbMap.relay, bulb_channel: discoveredBulbMap.channel
        })
      });
      if (response.ok) {
        alert("🎉 Flexible Dual-Relay Mapping Matrix Locked and Synchronized!");
        setShowWizard(false);
        fetchDeviceData();
      }
    } catch (err) { alert("Failed saving multi-relay hardware mapping logs."); }
  };

  // ==========================================
  // CORE DEVICE ACTIONS
  // ==========================================
  const handleMasterOff = async () => {
    if (!isAdmin) return;
    const confirmHalt = window.confirm(
      "Finalize Batch: Are you sure you want to conclude the Navyakosh fermentation phase? This will safely cut power to the ESP32 relays and mark the PROM as ready for packaging."
    );
    if (!confirmHalt) return;

    setHalting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/telemetry/device/${deviceId}/master-off`, { method: 'POST' });
      if (response.ok) {
        alert("Navyakosh batch concluded. Packaging notification broadcasted to plant floor.");
        fetchDeviceData();
      }
    } catch (error) { console.error("Failed to execute Master OFF:", error); } finally { setHalting(false); }
  };
   
  const handleTriggerCalibration = async (mode) => {
    if (!deviceId) return;
    const isReady = window.confirm(`Ready for ${mode} calibration?\n\nPlease ensure the sensor is properly positioned BEFORE clicking OK.`);
    if (!isReady) return;

    setIsCalibrating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/telemetry/device/${deviceId}/calibrate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: mode })
      });
      if (response.ok) alert(`✅ ${mode} Calibration Initiated!`);
      else alert(`Server Error: Failed to start calibration.`);
    } catch (err) { alert("Network Error: Could not connect to the backend."); } finally { setIsCalibrating(false); }
  };

  if (loading && deviceData.history.length === 0) {
    return <div className="text-center py-16 text-sm font-mono text-cyan-400 animate-pulse">ESTABLISHING SECURE NODE CONNECTION...</div>;
  }

  const { config, history, master_off_events = [] } = deviceData;
  const isReadyForPackaging = config?.cycle_status === 'READY_FOR_PACKAGING';

  // ----------------------------------------------------
  // CYCLE TIMER LOGIC (CRASH PROOF)
  // ----------------------------------------------------
  let cycleStart = Date.now();
  if (config?.cycle_start_time) {
    const ts = String(config.cycle_start_time);
    cycleStart = new Date(ts.endsWith('Z') ? ts : `${ts}Z`).getTime() || Date.now();
  }
  const daysRunning = (Date.now() - cycleStart) / (1000 * 60 * 60 * 24);
  const canMasterOff = daysRunning >= 5;

  // ----------------------------------------------------
  // FORMAT TIMESTAMPS & DATA ARRAYS (CRASH PROOF)
  // ----------------------------------------------------
  const timelineLabels = history.map(point => {
    if (!point || !point.timestamp) return '--';
    const ts = String(point.timestamp);
    const isUTC = ts.endsWith('Z') ? ts : `${ts}Z`;
    const d = new Date(isUTC);
    
    return timeRange > 24 
      ? d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
      : d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
  });
  
  const tempValues = history.map(point => point?.temperature ?? null);
  const moistureValues = history.map(point => point?.moisture ?? null);

  const masterOffMarkers = history.map(point => {
    if (!point || !point.timestamp) return null;
    const ts = String(point.timestamp);
    const pTime = new Date(ts.endsWith('Z') ? ts : `${ts}Z`).getTime();
    
    const isMarker = master_off_events.some(mo => {
      if (!mo) return false;
      const moStr = String(mo);
      const moTime = new Date(moStr.endsWith('Z') ? moStr : `${moStr}Z`).getTime();
      return Math.abs(moTime - pTime) < 1800000;
    });
    return isMarker ? point.temperature : null;
  });

  const latestTemp = tempValues.length > 0 ? tempValues[tempValues.length - 1] : '--';
  const latestMoist = moistureValues.length > 0 ? moistureValues[moistureValues.length - 1] : '--';

  // ==========================================
  // CALCULATE SMART CONNECTION STATUS (CRASH PROOF)
  // ==========================================
  let connectionStatus = 'PENDING';
  let lastSeenText = 'Never';

  if (config) {
    const now = new Date().getTime();
    let hubTime = 0;
    let nodeTime = 0;

    if (config.hub_last_seen) {
      const ts = String(config.hub_last_seen);
      hubTime = new Date(ts.endsWith('Z') ? ts : `${ts}Z`).getTime() || 0;
    }
    
    if (config.node_last_seen) {
      const ts = String(config.node_last_seen);
      nodeTime = new Date(ts.endsWith('Z') ? ts : `${ts}Z`).getTime() || 0;
    }

    const hubDiffHours = hubTime > 0 ? (now - hubTime) / (1000 * 60 * 60) : Infinity;
    const nodeDiffHours = nodeTime > 0 ? (now - nodeTime) / (1000 * 60 * 60) : Infinity;

    if (hubDiffHours > 5) connectionStatus = 'HUB_OFFLINE';
    else if (nodeDiffHours > 3 || nodeTime === 0) connectionStatus = 'NODE_OFFLINE';
    else connectionStatus = 'LIVE';

    const displayTime = nodeTime > 0 ? nodeTime : hubTime;
    if (displayTime > 0) {
      const d = new Date(displayTime);
      lastSeenText = `${d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()} IST`;
    }
  }

  const isDisconnected = connectionStatus === 'HUB_OFFLINE' || connectionStatus === 'NODE_OFFLINE';

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'rgba(33, 38, 45, 0.2)' }, ticks: { color: '#8b949e', font: { family: 'monospace', size: 10 } } },
      y: { grid: { color: 'rgba(33, 38, 45, 0.2)' }, ticks: { color: '#8b949e', font: { family: 'monospace', size: 10 } } }
    }
  };

  const tempData = {
    labels: timelineLabels,
    datasets: [
      { type: 'scatter', data: masterOffMarkers, pointStyle: 'rectRot', radius: 8, backgroundColor: '#ef4444', borderColor: '#991b1b', borderWidth: 2 },
      { type: 'line', data: tempValues, borderColor: '#f5c542', borderWidth: 2, pointBackgroundColor: '#f5c542', fill: false, tension: 0.2 }
    ]
  };

  const moistureData = {
    labels: timelineLabels,
    datasets: [{ data: moistureValues, borderColor: '#22d3ee', borderWidth: 2, pointBackgroundColor: '#22d3ee', fill: false, tension: 0.2 }]
  };

  return (
    <div className="space-y-6 pb-12 animate-[fadeIn_0.2s_ease-out] font-sans">
      
      {/* Header and Back Button */}
      <div className="flex justify-between items-center bg-[#161b22] border border-[#21262d] p-4 rounded-xl">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-2 hover:bg-[#21262d] rounded-lg text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center space-x-3">
              <h2 className="text-xl font-bold text-white tracking-wide">Tank Telemetry Stream</h2>
              {!isAdmin && <span className="px-2 py-0.5 bg-[#21262d] text-gray-400 border border-[#30363d] rounded text-[10px] font-mono tracking-wider">READ ONLY</span>}
            </div>
            <p className="text-xs text-gray-500 font-mono mt-0.5 tracking-wider">NODE ID: {deviceId}</p>
          </div>
        </div>
        
        <div className="text-right">
          <span className={`px-3 py-1 rounded font-mono text-xs font-bold border ${isReadyForPackaging ? 'bg-purple-950/50 text-purple-400 border-purple-900' : 'bg-emerald-950/50 text-emerald-400 border-emerald-900'}`}>
            {isReadyForPackaging ? 'PACKAGING PHASE' : 'FERMENTATION ACTIVE'}
          </span>
          {!isReadyForPackaging && config?.cycle_start_time && (
            <div className="text-[10px] text-gray-500 mt-1.5 font-mono">
              CYCLE DAY: <span className="text-gray-300 font-bold">{Math.floor(daysRunning) + 1}</span>
            </div>
          )}
        </div>
      </div>

      {/* --- EDITABLE CONTROL PARAMETERS OVERVIEW GRID --- */}
      <div>
        <div className="flex justify-between items-center mb-3 px-1">
          <h3 className="text-white text-sm font-bold flex items-center">
            <Sliders className="w-4 h-4 mr-2 text-cyan-400" /> Operational Edge Rules
          </h3>
          {isAdmin && !isEditingConfig && (
            <button onClick={handleEditConfigToggle} className="text-[11px] font-mono font-bold text-[#f5c542] hover:text-yellow-400 flex items-center transition-colors">
              <Edit3 className="w-3.5 h-3.5 mr-1.5" /> Modify Constraints
            </button>
          )}
          {isAdmin && isEditingConfig && (
            <div className="flex space-x-3">
              <button onClick={() => setIsEditingConfig(false)} className="text-[11px] font-mono text-gray-400 hover:text-red-400 transition-colors">Cancel</button>
              <button onClick={handleSaveConfig} disabled={savingConfig} className="text-[11px] font-mono bg-cyan-500 hover:bg-cyan-400 text-black px-3 py-1 rounded flex items-center font-bold transition-colors disabled:opacity-50">
                <Save className="w-3.5 h-3.5 mr-1" /> {savingConfig ? 'COMMITTING...' : 'SAVE & DEPLOY'}
              </button>
            </div>
          )}
        </div>

        {/* CSS grid gracefully adjusts: 3 columns for Super Admin, 2 columns for LCB_TEAM */}
        <div className={`grid grid-cols-1 gap-4 ${isSuperAdmin ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
          
          {/* Polling Interval Card - STRICTLY HIDDEN FROM LCB_TEAM */}
          {isSuperAdmin && (
            <div className="bg-[#0d1117] border border-[#21262d] p-5 rounded-xl flex items-center space-x-4">
              <div className="p-3 bg-blue-950/30 rounded-lg"><Clock className="w-6 h-6 text-blue-400" /></div>
              <div>
                <div className="text-[10px] font-mono text-gray-500 mb-1">POLLING INTERVAL</div>
                <div className="text-xl font-bold text-white font-mono flex items-center">
                  {isEditingConfig ? <input type="number" min="1" value={configForm.interval} onChange={e => setConfigForm({...configForm, interval: e.target.value})} className="w-16 bg-[#161b22] border border-[#30363d] rounded p-1 text-white outline-none focus:border-cyan-500 text-sm mr-2" /> : <span className="mr-2">{config?.telemetry_interval_ms ? (config.telemetry_interval_ms / 60000) : '--'}</span>}
                  <span className="text-sm font-sans font-normal text-gray-400">min</span>
                </div>
              </div>
            </div>
          )}

          <div className="bg-[#0d1117] border border-[#21262d] p-5 rounded-xl flex items-center space-x-4">
            <div className="p-3 bg-amber-950/30 rounded-lg"><Thermometer className="w-6 h-6 text-amber-400" /></div>
            <div>
              <div className="text-[10px] font-mono text-gray-500 mb-1">TEMP RANGE (MIN / MAX)</div>
              <div className="text-xl font-bold text-white font-mono flex items-center">
                {isEditingConfig ? <><input type="number" value={configForm.tempMin} onChange={e => setConfigForm({...configForm, tempMin: e.target.value})} className="w-16 bg-[#161b22] border border-[#30363d] rounded p-1 text-white outline-none focus:border-amber-500 text-sm" /><span className="text-gray-500 font-light mx-2">-</span><input type="number" value={configForm.tempMax} onChange={e => setConfigForm({...configForm, tempMax: e.target.value})} className="w-16 bg-[#161b22] border border-[#30363d] rounded p-1 text-white outline-none focus:border-amber-500 text-sm" /></> : <>{config?.temp_min}° <span className="text-gray-500 font-light mx-2">-</span> {config?.temp_max}°</>}
              </div>
            </div>
          </div>
          
          <div className="bg-[#0d1117] border border-[#21262d] p-5 rounded-xl flex items-center space-x-4">
            <div className="p-3 bg-cyan-950/30 rounded-lg"><Droplet className="w-6 h-6 text-cyan-400" /></div>
            <div>
              <div className="text-[10px] font-mono text-gray-500 mb-1">MOISTURE RANGE (MIN / MAX)</div>
              <div className="text-xl font-bold text-white font-mono flex items-center">
                {isEditingConfig ? <><input type="number" value={configForm.moistMin} onChange={e => setConfigForm({...configForm, moistMin: e.target.value})} className="w-16 bg-[#161b22] border border-[#30363d] rounded p-1 text-white outline-none focus:border-cyan-500 text-sm" /><span className="text-gray-500 font-light mx-2">-</span><input type="number" value={configForm.moistMax} onChange={e => setConfigForm({...configForm, moistMax: e.target.value})} className="w-16 bg-[#161b22] border border-[#30363d] rounded p-1 text-white outline-none focus:border-cyan-500 text-sm" /></> : <>{config?.moisture_min}% <span className="text-gray-500 font-light mx-2">-</span> {config?.moisture_max}%</>}
              </div>
            </div>
          </div>
        </div>
      </div>
      

      

      {/* --- AUTOMATED MAPPING SCANNER CARD LAYOUT (STRICTLY HIDDEN FROM LCB_TEAM) --- */}
      {isSuperAdmin && (
        <div className="bg-[#161b22] border border-[#21262d] p-5 rounded-xl space-y-4 font-mono text-xs">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-white text-sm font-bold flex items-center font-sans">
                <Sliders className="w-4 h-4 mr-2 text-yellow-500" />
                Automated Plant-Wide Hardware Sweeper
              </h3>
              <p className="text-gray-400 text-xs mt-1 font-sans">
                Systematically checks every terminal across all registered plant relay boards to identify component wiring hooks.
              </p>
            </div>
            {!showWizard ? (
              <button 
                onClick={() => { setShowWizard(true); setCurrentRelayIdx(0); setCurrentChannel(1); setDiscoveredFanMap(null); setDiscoveredBulbMap(null); }}
                className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-xs font-sans rounded transition-all"
              >
                RUN AUTOMATED SWEEP
              </button>
            ) : (
              <button onClick={() => setShowWizard(false)} className="text-gray-500 hover:text-red-400 text-xs flex items-center font-sans"><X className="w-4 h-4 mr-1" /> Terminate Scan</button>
            )}
          </div>

          {showWizard && (
            <div className="bg-[#0d1117] border border-gray-800 p-4 rounded-lg space-y-4 text-left">
              {availableRelays.length === 0 ? (
                <div className="text-red-400 text-xs italic">No registered relay boards detected for this factory path. Seed records inside the main control drawer panel first.</div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-gray-800 pb-2">
                    <div>
                      <span className="text-gray-500">CURRENT TARGET BOARD:</span> <span className="text-cyan-400 font-bold">{availableRelays[currentRelayIdx]}</span>
                      <span className="text-gray-600 mx-2">|</span>
                      <span className="text-gray-500">TERMINAL PIN:</span> <span className="text-yellow-500 font-bold">CH-{currentChannel}</span>
                    </div>
                    <span className="bg-blue-950/40 text-blue-400 border border-blue-900 px-2 py-0.5 rounded text-[10px]">
                      BOARD {currentRelayIdx + 1} OF {availableRelays.length}
                    </span>
                  </div>

                  <div className="bg-[#161b22] border border-gray-800 p-4 rounded-xl text-center space-y-3">
                    <div className="text-gray-400 text-[11px]">Click the pulse icon below to energize the current port pin. Observe the tank and classify what happens.</div>
                    <div className="flex gap-2 justify-center">
                      <button onClick={() => triggerSweepPulse(1)} disabled={testingActive} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded shadow-md animate-pulse flex items-center">⚡ ENERGIZE TERMINAL PIN CH-{currentChannel}</button>
                      <button onClick={() => triggerSweepPulse(0)} className="px-4 bg-red-950/40 text-red-400 border border-red-900 rounded">KILL PULSE</button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-gray-500 text-[10px]">CLASSIFY PHYSICAL BEHAVIOR</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <button onClick={() => advanceSweepStep('FAN')} className="p-3 bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-800 rounded-lg text-emerald-400 text-center font-bold">💨 EXHAUST FAN SPINS</button>
                      <button onClick={() => advanceSweepStep('BULB')} className="p-3 bg-purple-950/40 hover:bg-purple-900/50 border border-purple-800 rounded-lg text-purple-400 text-center font-bold">💡 HEATER BULB ILLUMINATES</button>
                      <button onClick={() => advanceSweepStep('NOTHING')} className="p-3 bg-[#161b22] hover:bg-gray-800 border border-gray-700 rounded-lg text-gray-400 text-center">❌ NOTHING HAPPENED</button>
                    </div>
                  </div>

                  <div className="bg-[#161b22]/40 border border-gray-800 p-3 rounded-lg text-[11px] text-gray-400 space-y-1">
                    <div className="text-gray-500 font-bold tracking-wide text-[10px] uppercase mb-1">Live Split-Relay Verification Logs:</div>
                    <div>• Fan Actuator: {discoveredFanMap ? <span className="text-emerald-400 font-bold">{discoveredFanMap.relay} ➔ CH-{discoveredFanMap.channel}</span> : <span className="text-gray-600">Sweeping...</span>}</div>
                    <div>• Bulb Actuator: {discoveredBulbMap ? <span className="text-purple-400 font-bold">{discoveredBulbMap.relay} ➔ CH-{discoveredBulbMap.channel}</span> : <span className="text-gray-600">Sweeping...</span>}</div>
                  </div>

                  {(discoveredFanMap || discoveredBulbMap) && (
                    <button onClick={handleFinalSave} className="w-full py-2 bg-yellow-500 text-black font-bold uppercase hover:bg-yellow-400 tracking-wider font-sans text-xs rounded transition-all">COMMIT & SAVE DISCOVERED CONFIGURATION MATRIX</button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* OTA CALIBRATION PANEL */}
      {isAdmin && (
      <div className="bg-[#161b22] border border-[#21262d] p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center">
        <div className="mb-3 sm:mb-0">
          <h3 className="text-white text-sm font-bold flex items-center"><Settings className="w-4 h-4 mr-2 text-cyan-400" /> OTA Sensor Calibration</h3>
          <p className="text-gray-400 text-xs mt-1 max-w-lg">Run these sequences during physical maintenance. The cloud will command the ESP32 into a high-frequency polling burst to calculate a statistically trimmed baseline.</p>
        </div>
        <div className="flex space-x-3 w-full sm:w-auto">
          <button onClick={() => handleTriggerCalibration('DRY')} disabled={isCalibrating} className="flex-1 sm:flex-none px-4 py-2 bg-transparent border border-gray-600 hover:border-yellow-500 text-gray-300 hover:text-yellow-500 disabled:opacity-50 text-xs font-mono font-bold rounded transition-all">CALIBRATE DRY</button>
          <button onClick={() => handleTriggerCalibration('WET')} disabled={isCalibrating} className="flex-1 sm:flex-none px-4 py-2 bg-transparent border border-gray-600 hover:border-blue-400 text-gray-300 hover:text-blue-400 disabled:opacity-50 text-xs font-mono font-bold rounded transition-all">CALIBRATE WET</button>
        </div>
      </div>
      )}
      
      {/* --- SMART CONNECTION STATUS BANNER --- */}
      <div className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
        connectionStatus === 'LIVE' ? 'bg-emerald-950/20 border-emerald-900/50' : 
        connectionStatus === 'NODE_OFFLINE' ? 'bg-yellow-950/20 border-yellow-900/50 shadow-[inset_0_0_20px_rgba(250,204,21,0.05)]' : 
        connectionStatus === 'HUB_OFFLINE' ? 'bg-red-950/20 border-red-900/50 shadow-[inset_0_0_20px_rgba(239,68,68,0.05)]' :
        'bg-[#0d1117] border-[#21262d]'
      }`}>
        <div className="flex items-center space-x-4">
          <div className={`p-3 rounded-lg ${
            connectionStatus === 'LIVE' ? 'bg-emerald-900/30' : 
            connectionStatus === 'NODE_OFFLINE' ? 'bg-yellow-900/30' : 
            connectionStatus === 'HUB_OFFLINE' ? 'bg-red-900/30' : 'bg-gray-800/50'
          }`}>
            {connectionStatus === 'LIVE' ? <Wifi className="w-6 h-6 text-emerald-400" /> : 
             connectionStatus === 'NODE_OFFLINE' ? <AlertTriangle className="w-6 h-6 text-yellow-400 animate-pulse" /> :
             connectionStatus === 'HUB_OFFLINE' ? <WifiOff className="w-6 h-6 text-red-500 animate-pulse" /> :
             <WifiOff className="w-6 h-6 text-gray-500" />}
          </div>
          <div>
            <h4 className={`text-sm font-bold font-mono tracking-wider ${
              connectionStatus === 'LIVE' ? 'text-emerald-400' : 
              connectionStatus === 'NODE_OFFLINE' ? 'text-yellow-400' : 
              connectionStatus === 'HUB_OFFLINE' ? 'text-red-500' : 'text-gray-400'
            }`}>
              {connectionStatus === 'LIVE' ? 'NODE ACTIVE & TRANSMITTING' : 
               connectionStatus === 'NODE_OFFLINE' ? 'CAUTION: TANK NODE UNREACHABLE' : 
               connectionStatus === 'HUB_OFFLINE' ? 'CRITICAL: CENTRAL HUB DISCONNECTED' : 'PROVISIONING PENDING'}
            </h4>
            <p className="text-xs text-gray-400 mt-1 max-w-xl leading-relaxed">
              {connectionStatus === 'HUB_OFFLINE'
                ? "The main factory WiFi router is offline. Check the power source or reconnect it to the local WiFi using the mobile captive portal. All nodes are currently blind."
                : connectionStatus === 'NODE_OFFLINE' 
                ? "The central hub is online, but this specific tank hasn't reported telemetry in over 3 hours. Please check the ESP32 battery or mesh range." 
                : connectionStatus === 'LIVE' 
                ? "The telemetry stream is stable and syncing perfectly with the central factory hub."
                : "Awaiting first telemetry ping from hardware."}
            </p>
          </div>
        </div>
        <div className="text-left md:text-right border-t md:border-t-0 border-[#21262d] pt-3 md:pt-0 shrink-0">
          <div className="text-[10px] font-mono text-gray-500 mb-1 uppercase tracking-wider">
            {connectionStatus === 'HUB_OFFLINE' ? 'Last Known Hub Sync' : 'Last Hardware Sync'}
          </div>
          <div className="text-sm font-bold text-white font-mono bg-[#161b22] px-3 py-1.5 rounded border border-[#21262d]">{lastSeenText}</div>
        </div>
      </div>

      {/* --- TIME SERIES FILTER --- */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-[#161b22] border border-[#21262d] p-3 rounded-lg">
        <div className="flex items-center space-x-2 mb-3 sm:mb-0">
          <CalendarDays className="w-4 h-4 text-gray-400" />
          <span className="text-xs font-mono font-bold text-gray-300">HISTORICAL TELEMETRY SCOPE</span>
        </div>
        <div className="flex space-x-1.5 bg-[#0d1117] border border-[#21262d] p-1 rounded-md">
          {[ {label: '12H', val: 12}, {label: '1D', val: 24}, {label: '5D', val: 120}, {label: '15D', val: 360}, {label: '30D', val: 720} ].map(btn => (
            <button 
              key={btn.val} 
              onClick={() => setTimeRange(btn.val)} 
              className={`px-3 py-1.5 text-[10px] font-mono font-bold rounded transition-all ${timeRange === btn.val ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-[#21262d]'}`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Charts Panel Display */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-[#21262d]/50 pb-3">
            <div className="flex items-center space-x-2 text-sm font-bold tracking-wide text-white">
              <Thermometer className="w-4 h-4 text-amber-500" /><span>Temperature Trend</span>
            </div>
            <span className="text-xl font-bold text-white font-mono">{latestTemp}°C</span>
          </div>
          {history.length > 0 ? (
            <div className="h-56"><Line options={chartOptions} data={tempData} /></div>
          ) : (
            <div className="h-56 flex items-center justify-center text-xs font-mono text-gray-600 border border-dashed border-[#21262d] rounded-lg">NO DATA</div>
          )}
          <div className="flex items-center space-x-2 justify-end text-[9px] font-mono text-gray-500 pt-2">
            <div className="w-2 h-2 bg-red-500 rotate-45"></div> <span>Red Marker = Batch Concluded</span>
          </div>
        </div>

        <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-center border-b border-[#21262d]/50 pb-3">
            <div className="flex items-center space-x-2 text-sm font-bold tracking-wide text-white">
              <Droplet className="w-4 h-4 text-cyan-400" /><span>Moisture Trend</span>
            </div>
            <span className="text-xl font-bold text-white font-mono">{latestMoist}%</span>
          </div>
          {history.length > 0 ? (
            <div className="h-56"><Line options={chartOptions} data={moistureData} /></div>
          ) : (
            <div className="h-56 flex items-center justify-center text-xs font-mono text-gray-600 border border-dashed border-[#21262d] rounded-lg">NO DATA</div>
          )}
        </div>
      </div>
        
      {/* --- LIVE ACTUATOR STATUS MATRIX --- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* EXHAUST FAN CARD */}
        <div className="bg-[#161b22] border border-[#21262d] p-5 rounded-xl relative overflow-hidden transition-all">
          <div className="absolute top-4 right-4">
            {config?.fan_status === 1 ? (
              <span className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full mr-1.5 animate-pulse"></span> ON
              </span>
            ) : (
              <span className="px-2 py-1 rounded text-[10px] font-bold bg-gray-800 text-gray-500 border border-gray-700 flex items-center">
                <span className="w-1.5 h-1.5 bg-gray-600 rounded-full mr-1.5"></span> OFF
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-2 bg-emerald-950/30 rounded-lg"><Activity className="w-5 h-5 text-emerald-400" /></div>
            <span className="text-gray-400 font-sans font-bold text-xs uppercase tracking-wider">EXHAUST FAN </span>
          </div>
        </div>

        {/* HEATER BULB CARD */}
        <div className="bg-[#161b22] border border-[#21262d] p-5 rounded-xl relative overflow-hidden transition-all">
          <div className="absolute top-4 right-4">
            {config?.bulb_status === 1 ? (
              <span className="px-2 py-1 rounded text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center shadow-[0_0_8px_rgba(168,85,247,0.3)]">
                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full mr-1.5 animate-pulse"></span> ON
              </span>
            ) : (
              <span className="px-2 py-1 rounded text-[10px] font-bold bg-gray-800 text-gray-500 border border-gray-700 flex items-center">
                <span className="w-1.5 h-1.5 bg-gray-600 rounded-full mr-1.5"></span> OFF
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-2 bg-purple-950/30 rounded-lg"><Activity className="w-5 h-5 text-purple-400" /></div>
            <span className="text-gray-400 font-sans font-bold text-xs uppercase tracking-wider">HEATER BULBS </span>
          </div>
        </div>
      </div>

      {/* Action Zone: Master Off Trigger */}
      {isAdmin && (
        <div className={`border p-6 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${isReadyForPackaging ? 'bg-emerald-950/10 border-emerald-900/30' : 'bg-[#0d1117] border-[#21262d]'}`}>
          <div>
            <h4 className="text-white font-bold flex items-center text-lg">
              <Sprout className={`w-5 h-5 mr-2 ${isReadyForPackaging ? 'text-emerald-400' : 'text-[#f5c542]'}`} />
              Harvest Navyakosh Bio-Fertilizer
            </h4>
            <p className="text-xs text-gray-400 mt-1.5 max-w-2xl leading-relaxed">
              {isReadyForPackaging 
                ? "Excellent work. This high-grade Navyakosh PROM batch is finalized and ready for the agricultural supply chain. A new batch will automatically initialize 48 hours after fresh biomass telemetry is detected."
                : canMasterOff 
                  ? "Triggering this action concludes the active biological phase, safely cutting power to the ESP32 relays. The Navyakosh PROM batch is now stabilized and ready for distribution."
                  : "The biological fermentation phase requires a minimum continuous 5-day cycle to ensure the microbial cultures correctly process the rock phosphate matrix. The finalization sequence is currently locked."}
            </p>
          </div>
          
          <button 
            onClick={handleMasterOff}
            disabled={halting || isReadyForPackaging || !canMasterOff || isDisconnected}
            className={`flex items-center justify-center px-6 py-3 font-bold font-mono rounded-lg border transition-all whitespace-nowrap ${
              isReadyForPackaging 
                ? 'bg-emerald-900/30 text-emerald-500 border-emerald-800/50 cursor-not-allowed'
                : (canMasterOff && !isDisconnected)
                  ? 'bg-red-500/10 hover:bg-red-500/20 text-red-500 border-red-500/50' 
                  : 'bg-gray-900 text-gray-600 border-gray-800 cursor-not-allowed'
            }`}
          >
            {isReadyForPackaging ? <><CheckCircle2 className="w-5 h-5 mr-2" /> BATCH FINALIZED</> : <><Power className="w-5 h-5 mr-2" /> {halting ? "CONCLUDING..." : "MASTER OFF"}</>}
          </button>
        </div>
      )}

    </div>
  );
}