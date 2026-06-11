import React, { useState } from 'react';
import LoginView from './components/LoginView';
import DashboardContainer from './components/DashboardContainer';

// 🌟 THE MISSING ENGINE LINK: Dynamically switches between local testing and your live cloud container backend
export const API_BASE_URL = 
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:3000"
    : "https://iot-control-backend.vercel.app"; 
    // ⚠️ CRITICAL: Replace the string above with your actual live FastAPI backend deployment URL on Vercel!
    // Make sure it starts with 'https://' and has NO trailing slash at the end.

    export default function App() {
      // 🔄 INITIALIZER PASS: Read local cache on startup to check for an active user session token
      const [session, setSession] = useState(() => {
        const savedSession = localStorage.getItem('iot_control_session');
        if (savedSession) {
          try {
            const parsed = JSON.parse(savedSession);
            // Enforce a strict session lifetime expiration check
            if (Date.now() < parsed.expiresAt) {
              return parsed.user;
            }
            // Wipe expired session artifacts if the time bounds have run out
            localStorage.removeItem('iot_control_session');
          } catch (e) {
            console.error("Corrupted session cache cleared:", e);
          }
        }
        return null;
      });
    
      const [activeDevice, setActiveDevice] = useState(null);
    
      // 🕒 LIFECYCLE MONITOR: Synchronizes component state mutations directly into browser memory
      const handleLoginSuccess = (userData) => {
        // Session lifetime duration limit parameters (e.g., 8 Hours operational shifts)
        const SESSION_DURATION_HOURS = 8;
        const expirationTimestamp = Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000;
    
        const sessionPayload = {
          user: userData,
          expiresAt: expirationTimestamp
        };
    
        localStorage.setItem('iot_control_session', JSON.stringify(sessionPayload));
        setSession(userData);
      };
    
      const handleLogout = () => {
        localStorage.removeItem('iot_control_session');
        setSession(null);
        setActiveDevice(null);
      };
    
      return (
        <div className="min-h-screen flex flex-col justify-between p-4 bg-[#0d1117] text-gray-300">
          {!session ? (
            <LoginView onLoginSuccess={handleLoginSuccess} />
          ) : (
            <DashboardContainer 
              session={session} 
              onLogout={handleLogout}
              activeDevice={activeDevice}
              setActiveDevice={setActiveDevice}
            />
          )}
          
          <footer className="mt-8 border-t border-[#21262d] pt-4 text-center text-xs text-gray-600 font-mono">
            &copy; 2026 IoT Control System Inc. All hardware nodes operations logged securely.
          </footer>
        </div>
      );
    }