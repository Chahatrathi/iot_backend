import React, { useState } from 'react';
import { LogOut, SlidersHorizontal } from 'lucide-react';
import PlantOverview from './PlantOverview';
import DeviceTelemetry from './DeviceTelemetry';
import HardwareHubModal from './HardwareHubModal';

export default function DashboardContainer({ session, onLogout, activeDevice, setActiveDevice }) {
  const [showHardwareHub, setShowHardwareHub] = useState(false);

  return (
    // Added px-4 sm:px-6 lg:px-8 to prevent the container from touching the screen edges on mobile
    <div className="w-full max-w-7xl mx-auto flex-grow flex flex-col pt-4 px-4 sm:px-6 lg:px-8">
      
      {/* Universal Header System */}
      {/* Changed to flex-col on mobile, row on medium screens and up */}
      <header className="flex flex-col md:flex-row md:justify-between items-start md:items-center border-b border-[#21262d] pb-4 mb-6 gap-4 md:gap-0">
        
        {/* Brand / Role Section */}
        <div className="flex items-center space-x-3 w-full md:w-auto justify-between md:justify-start">
          <span className="text-xl font-bold text-white tracking-wide">IoT Control</span>
          <span className="bg-[#f5c542]/10 border border-[#f5c542]/30 text-[#f5c542] px-2.5 py-0.5 rounded-full text-xs font-medium font-mono">
            {session.role}
          </span>
        </div>
        
        {/* User Info / Actions Section */}
        {/* Takes full width on mobile, separates user info and logout button */}
        <div className="flex items-center justify-between md:justify-end w-full md:w-auto space-x-4 md:space-x-6 text-sm text-gray-400 font-mono">
          
          <div className="flex flex-col items-start md:items-end flex-grow">
            {/* Truncated email to prevent layout breaking on small screens */}
            <span className="text-gray-300 font-medium truncate max-w-[160px] sm:max-w-xs">
              {session.email}
            </span>
            
            {session.role === 'SUPER_ADMIN' && (
              <button 
                onClick={() => setShowHardwareHub(true)} 
                className="mt-1 flex items-center space-x-1.5 text-xs text-[#f5c542] hover:text-[#e0b234] bg-[#f5c542]/5 border border-[#f5c542]/20 px-2.5 py-1 rounded transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {/* Shortened button text on mobile to save space */}
                <span className="hidden sm:inline">Manage Hardware</span>
                <span className="sm:hidden">Hardware</span>
              </button>
            )}
          </div>
          
          <button 
            onClick={onLogout} 
            className="flex items-center space-x-1.5 hover:text-white bg-[#161b22] border border-[#21262d] px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
          >
            <LogOut className="w-4 h-4" />
            {/* Hidden logout text on extremely small screens if needed, otherwise visible */}
            <span className="hidden sm:inline">Logout</span>
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