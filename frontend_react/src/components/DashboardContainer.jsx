import React, { useState } from 'react';
import { LogOut, SlidersHorizontal } from 'lucide-react';
import PlantOverview from './PlantOverview';
import DeviceTelemetry from './DeviceTelemetry';
import HardwareHubModal from './HardwareHubModal';

export default function DashboardContainer({ session, onLogout, activeDevice, setActiveDevice }) {
  const [showHardwareHub, setShowHardwareHub] = useState(false);

  return (
    <div className="w-full max-w-7xl mx-auto flex-grow flex flex-col pt-4">
      {/* Universal Header System */}
      <header className="flex justify-between items-center border-b border-[#21262d] pb-4 mb-6">
        <div className="flex items-center space-x-3">
          <span className="text-xl font-bold text-white tracking-wide">IoT Control</span>
          <span className="bg-[#f5c542]/10 border border-[#f5c542]/30 text-[#f5c542] px-2.5 py-0.5 rounded-full text-xs font-medium font-mono">
            {session.role}
          </span>
        </div>
        
        <div className="flex items-center space-x-6 text-sm text-gray-400 font-mono">
          <div className="flex flex-col items-end">
            <span className="text-gray-300 font-medium">{session.email}</span>
            {session.role === 'SUPER_ADMIN' && (
              <button 
                onClick={() => setShowHardwareHub(true)} 
                className="mt-1 flex items-center space-x-1 text-xs text-[#f5c542] hover:text-[#e0b234] bg-[#f5c542]/5 border border-[#f5c542]/20 px-2.5 py-1 rounded transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Manage Hardware</span>
              </button>
            )}
          </div>
          <button 
            onClick={onLogout} 
            className="flex items-center space-x-1 hover:text-white bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Dynamic View Toggler */}
      {!activeDevice ? (
        <PlantOverview session={session} onSelectDevice={setActiveDevice} />
      ) : (
        <DeviceTelemetry session={session} deviceId={activeDevice} onBack={() => setActiveDevice(null)} />
      )}

      {/* Admin Topology Panel Hook */}
      {showHardwareHub && (
        <HardwareHubModal onClose={() => setShowHardwareHub(false)} />
      )}
    </div>
  );
}