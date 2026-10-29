import React, { useState } from 'react';
import { api } from '../api';
import { Heart, Lock, User, KeyRound, AlertCircle } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorVisible, setErrorVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErrorVisible(false);
    setIsLoading(true);

    try {
      await api.login(username, password);
      onLoginSuccess();
    } catch (err) {
      console.error('Login failed', err);
      setErrorVisible(true);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div id="login_container" className="min-h-screen bg-linear-to-r from-teal-400 via-cyan-500 to-indigo-500 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full transition-all duration-300 transform hover:scale-[1.01]">
        <div className="flex flex-col items-center mb-8">
          <div className="p-4 bg-teal-50 rounded-full text-teal-600 mb-3 animate-pulse">
            <Heart className="w-10 h-10 fill-teal-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight text-center">
            Quản Lý Hồ Sơ Nha Khoa
          </h2>
          <p className="text-sm text-slate-500 mt-1">Đăng nhập hệ thống quản lý hồ sơ</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Tên đăng nhập
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                <User size={18} />
              </span>
              <input
                id="username_input"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Tên đăng nhập"
                required
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Mật khẩu
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400">
                <Lock size={18} />
              </span>
              <input
                id="password_input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                required
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {errorVisible && (
            <div id="login_error_alert" className="flex items-center gap-2 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 animate-shake">
              <AlertCircle size={16} className="shrink-0" />
              <span>Sai tài khoản hoặc mật khẩu!</span>
            </div>
          )}

          <button
            id="login_submit_btn"
            type="submit"
            disabled={isLoading}
            className="w-full py-3 px-4 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-semibold rounded-lg shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <KeyRound size={18} />
            )}
            <span>Đăng nhập</span>
          </button>
        </form>

        <div className="mt-8 text-center border-t border-slate-100 pt-4 text-xs text-slate-400">
          Nha Khoa Bình Thuận · Nha Khoa Cư Bao &copy; 2026
        </div>
      </div>
    </div>
  );
}
