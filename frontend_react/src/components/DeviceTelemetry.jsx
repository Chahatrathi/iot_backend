import React, { useState } from 'react';
import { ArrowLeft, Thermometer, Droplet, Lightbulb, Sliders } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

export default function DeviceTelemetry({ deviceId, onBack }) {
  const [minMoisture, setMinMoisture] = useState(38);
  const [maxMoisture, setMaxMoisture] = useState(60);
  const [minTemp, setMinTemp] = useState(68);
  const [maxTemp, setMaxTemp] = useState(85);

  const timelineLabels = ['12:00', '13:00', '14:00', '15:00', '16:00', '17:15'];
  
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
    datasets: [{ data: [72, 73, 75, 74, 76, 76.5], borderColor: '#f5c542', borderWidth: 2, pointBackgroundColor: '#f5c542', fill: false, tension: 0.2 }]
  };

  const moistureData = {
    labels: timelineLabels,
    datasets: [{ data: [55, 54, 53, 52, 52.5, 52.3], borderColor: '#22d3ee', borderWidth: 2, pointBackgroundColor: '#22d3ee', fill: false, tension: 0.2 }]
  };

  return (
    <div className="space-y-6 pb-12 animate-[fadeIn_0.2s_ease-out]">
      <div className="flex justify-between items-center">
        <button onClick={onBack} className="flex items-center space-x-2 text-sm text-gray-400 hover:text-white font-mono transition-colors">
          <ArrowLeft className="w-4 h-4" /> <span>Back to Overview</span>
        </button>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-white">{deviceId} — Plant Operations Monitor</h2>
        <p className="text-xs text-gray-500 font-mono mt-1 uppercase tracking-wider">Active telemetry stream packets verified</p>
      </div>

      {/* Charts Panel Display */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-2 text-sm font-medium text-white"><Thermometer className="w-4 h-4 text-amber-500" /><span>Temperature</span></div>
            <span className="text-2xl font-bold text-white font-mono">76.5°F</span>
          </div>
          <div className="h-56"><Line options={chartOptions} data={tempData} /></div>
        </div>

        <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-5 space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-2 text-sm font-medium text-white"><Droplet className="w-4 h-4 text-cyan-400" /><span>Moisture</span></div>
            <span className="text-2xl font-bold text-white font-mono">52.3%</span>
          </div>
          <div className="h-56"><Line options={chartOptions} data={moistureData} /></div>
        </div>
      </div>

      {/* Rules Processing Cards */}
      <div className="bg-[#161b22] border border-[#21262d] rounded-xl p-5 space-y-4">
        <div className="text-sm font-semibold text-white tracking-wide flex items-center space-x-2"><Sliders className="w-4 h-4 text-[#f5c542]" /><span>Automation Threshold Rules</span></div>
        <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-5 space-y-5 font-mono text-xs">
          <div className="space-y-3">
            <div className="flex items-center space-x-2"><Lightbulb className="text-cyan-400 w-5 h-5" /><span class="text-white font-semibold text-sm">CH1: Heating Bulb Array Configuration</span></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input type="number" value={minMoisture} onChange={e => setMinMoisture(Number(e.target.value))} className="p-3 bg-[#161b22] border border-[#30363d] rounded-lg text-white" placeholder="Min Moist" />
              <input type="number" value={maxMoisture} onChange={e => setMaxMoisture(Number(e.target.value))} className="p-3 bg-[#161b22] border border-[#30363d] rounded-lg text-white" placeholder="Max Moist" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}