import React, { useState } from 'react';
import { Cpu, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { API_BASE_URL } from '../App'; // Ensure this points to your Vercel backend URL

export default function LoginView({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  // 🌟 LIVE BACKEND HANDSHAKE ENGINE
  const handleLogin = async (e) => {
    e.preventDefault();
    setError(false);
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Persist session tokens locally to keep authentication persistent across page refreshes
        localStorage.setItem('user_role', data.user.role);
        localStorage.setItem('user_name', data.user.username);
        localStorage.setItem('user_email', data.user.email);
        localStorage.setItem('user_id', data.user.id);

        // Pipe user data directly into your dashboard router state layout
        onLoginSuccess({
          id: data.user.id,
          email: data.user.email,
          role: data.user.role,
          username: data.user.username,
          factory_id: data.user.factory_id || 1, // Fallback scope matrix indicator
        });
      } else {
        // Backend credential mismatch or missing registration rows
        setError(data.detail || "Invalid email or password configuration.");
      }
    } catch (err) {
      console.error("Authentication handshake failure:", err);
      setError("Network error: Cannot establish communication with core cluster.");
    } finally {
      setLoading(false);
    }
  };

  // Helper function to quickly test dynamic credentials from the selection drawer
  const fillTestCredentials = (testEmail, testPass = 'password123') => {
    setEmail(testEmail);
    setPassword(testPass);
    setError(false);
  };

  return (
    <div className="flex-grow flex flex-col items-center justify-center my-auto min-h-[80vh]">
      {/* Header Panel */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-[#f1c40f]/10 rounded-xl mb-4 border border-[#f1c40f]/20 shadow-[0_0_20px_rgba(241,196,15,0.15)]">
          <Cpu className="w-7 h-7 text-[#f5c542]" />
        </div>
        <h1 className="text-3xl font-semibold text-white tracking-wide">IoT Control</h1>
        <p className="text-xs text-gray-500 tracking-widest uppercase mt-1 font-mono">Fertilizer Manufacturing Control System</p>
      </div>

      {/* Main Login Card */}
      <div className="w-full max-w-md bg-[#161b22] border border-[#21262d] rounded-xl p-8 shadow-2xl mb-6">
        <form onSubmit={handleLogin} className="space-y-6">
          {error && (
            <div className="text-center text-xs font-semibold bg-red-900/20 text-red-400 border border-red-900/50 p-2.5 rounded-lg font-mono whitespace-pre-wrap">
              {typeof error === 'string' ? error : "Invalid email or password."}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-400 tracking-wider uppercase mb-2 font-mono">Email Address</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500">
                <Mail className="w-5 h-5" />
              </span>
              <input 
                type="email" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                required
                disabled={loading}
                className="w-full pl-10 pr-4 py-3 bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-[#f5c542] focus:ring-1 focus:ring-[#f5c542] transition-colors disabled:opacity-50" 
                placeholder="Enter email address" 
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 tracking-wider uppercase mb-2 font-mono">Security Password</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500">
                <Lock className="w-5 h-5" />
              </span>
              <input 
                type={showPassword ? "text" : "password"} 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                required
                disabled={loading}
                className="w-full pl-10 pr-12 py-3 bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-[#f5c542] focus:ring-1 focus:ring-[#f5c542] transition-colors disabled:opacity-50" 
                placeholder="Enter password key" 
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)} 
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-300 focus:outline-none"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full py-3 bg-[#f5c542] hover:bg-[#e0b234] disabled:bg-gray-800 text-black font-semibold rounded-lg transition-colors duration-200 tracking-wide font-mono text-xs uppercase"
          >
            {loading ? "AUTHENTICATING CLUSTER ACCOUNT..." : "Access Control Panel"}
          </button>
        </form>
      </div>
    </div>
  );
}