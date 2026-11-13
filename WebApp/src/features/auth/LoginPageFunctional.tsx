import React, { useState } from "react";
import { Mail, Lock, ArrowLeft, Eye, EyeOff, Recycle, Leaf, Shield } from "lucide-react";
import AuthBrandLogos from "./AuthBrandLogos";
import { supabase } from "../../services/supabaseClient";

type WebLoginRole = "admin" | "dispatcher" | "supervisor";

interface LoginPageFunctionalProps {
  onLogin: (params: { email: string; password: string; role?: WebLoginRole }) => Promise<void>;
  onRegister?: () => void;
  onBack: () => void;
}

export default function LoginPageFunctional({ onLogin, onBack }: LoginPageFunctionalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordValid = password.length >= 8;

  const handleForgotPassword = async () => {
    setError(null);
    setResetStatus(null);
    if (!emailValid) {
      setError("Enter your work email address first to receive a password reset link.");
      return;
    }
    setIsSubmitting(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
      if (resetError) throw resetError;
      setResetStatus("If this email is registered, a password reset link has been sent.");
    } catch (err: any) {
      setError(err?.message ?? "Unable to send password reset email.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetStatus(null);
    if (!emailValid) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!passwordValid) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onLogin({ email, password });
    } catch (err: any) {
      setError(err?.message ?? "Invalid email or password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative w-full min-h-screen overflow-hidden bg-white flex">
      {/* Left Side - Branding & Info */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 relative overflow-hidden">
        <div className="relative z-10 flex flex-col p-12 text-white w-full">
          <div className="flex flex-1 flex-col justify-center space-y-8">
            <div className="text-center">
              <div className="mb-8">
                <AuthBrandLogos />
              </div>
              <h1 className="text-5xl font-bold mb-4 leading-tight tracking-tight">
                EcoLoop
              </h1>
              <p className="text-lg text-emerald-50 max-w-md mx-auto leading-relaxed">
                Smart routing, real-time monitoring, and efficient waste collection for a cleaner Naga City.
              </p>
            </div>

            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center justify-center bg-white/10 border border-white/15 rounded-xl p-4">
                <Recycle className="size-7 text-white" aria-hidden="true" />
              </div>
              <div className="flex items-center justify-center bg-white/10 border border-white/15 rounded-xl p-4">
                <Shield className="size-7 text-white" aria-hidden="true" />
              </div>
              <div className="flex items-center justify-center bg-white/10 border border-white/15 rounded-xl p-4">
                <Leaf className="size-7 text-white" aria-hidden="true" />
              </div>
            </div>
          </div>

          <div className="text-sm text-emerald-100/80">
            © 2026 EcoLoop · City of Naga SWMO
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-8 bg-gray-50 relative min-h-screen">
        <button
          type="button"
          onClick={onBack}
          className="absolute top-4 sm:top-6 left-4 sm:left-6 flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors p-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 min-h-[44px]"
          aria-label="Back to welcome screen"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
          <span className="font-medium text-sm sm:text-base">Back</span>
        </button>

        {/* Login Form */}
        <div className="w-full max-w-md mt-14 lg:mt-0 rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 shadow-sm">
          <div className="mb-6 lg:hidden">
            <AuthBrandLogos compact />
          </div>

          <div className="text-center mb-7">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1.5 tracking-tight">
              Sign In
            </h2>
            <p className="text-sm text-gray-600">
              Access your EcoLoop operations dashboard
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-sm">
                {error}
              </div>
            )}
            {resetStatus && (
              <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 text-sm">
                {resetStatus}
              </div>
            )}

            <div>
              <label htmlFor="login-email" className="block font-medium text-sm text-gray-700 mb-1.5">
                Email Address
              </label>
              <div className="relative group">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 size-5 text-gray-400 group-focus-within:text-emerald-600 transition-colors" aria-hidden="true" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Work email"
                  required
                  disabled={isSubmitting}
                  className="w-full h-12 pl-11 pr-4 bg-white border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-emerald-600 focus:ring-3 focus:ring-emerald-100 transition-colors"
                />
              </div>
              {email.length > 0 && !emailValid && <p className="mt-1.5 text-xs text-red-600">Invalid email format.</p>}
            </div>

            <div>
              <label htmlFor="login-password" className="block font-medium text-sm text-gray-700 mb-1.5">
                Password
              </label>
              <div className="relative group">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 size-5 text-gray-400 group-focus-within:text-emerald-600 transition-colors" aria-hidden="true" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  disabled={isSubmitting}
                  className="w-full h-12 pl-11 pr-12 bg-white border border-gray-300 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-emerald-600 focus:ring-3 focus:ring-emerald-100 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex size-10 items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  {showPassword ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
                </button>
              </div>
              {password.length > 0 && !passwordValid && <p className="mt-1.5 text-xs text-red-600">Use at least 8 characters.</p>}
            </div>

            <div className="flex items-center justify-between">
              <label htmlFor="login-remember" className="flex items-center gap-2 cursor-pointer min-h-[36px]">
                <input
                  id="login-remember"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="size-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-600 focus:ring-2"
                />
                <span className="text-sm text-gray-700">Remember me</span>
              </label>
              <button
                type="button"
                onClick={() => void handleForgotPassword()}
                disabled={isSubmitting}
                className="font-medium text-sm text-emerald-700 hover:text-emerald-800 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 px-1 py-1"
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full min-h-[48px] bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
            >
              <span className="flex items-center justify-center gap-2">
                {isSubmitting ? "Signing in…" : "Sign In"}
                <ArrowLeft className="size-4 rotate-180" aria-hidden="true" />
              </span>
            </button>

            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center text-xs text-gray-600">
              Staff accounts are invite-only. Contact your SWMO System Administrator to request access or role changes.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
