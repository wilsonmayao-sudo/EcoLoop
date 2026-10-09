import React, { useState } from "react";
import { Mail, Lock, ArrowLeft, Eye, EyeOff, Recycle, Leaf, Shield } from "lucide-react";
import CustomSelect from "../../components/ui/CustomSelect";
import AuthBrandLogos from "./AuthBrandLogos";

type WebLoginRole = "admin" | "dispatcher" | "supervisor";

const roleOptions = [
  { value: "admin", label: "Admin" },
  { value: "dispatcher", label: "Dispatcher" },
  { value: "supervisor", label: "Supervisor" },
];

interface LoginPageFunctionalProps {
  onLogin: (params: { email: string; password: string; role: WebLoginRole }) => Promise<void>;
  onRegister: () => void;
  onBack: () => void;
}

export default function LoginPageFunctional({ onLogin, onRegister, onBack }: LoginPageFunctionalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<WebLoginRole>("dispatcher");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordValid = password.length >= 8;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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
      await onLogin({ email, password, role });
    } catch (err: any) {
      setError(err?.message ?? "Invalid email or password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative w-full min-h-screen overflow-hidden bg-white flex">
      {/* Left Side - Branding & Info */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 relative overflow-hidden">
        {/* Animated Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 left-10 w-72 h-72 bg-white rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-white rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
        {/* Content */}
        <div className="relative z-10 flex flex-col p-12 text-white w-full">
          {/* Main Content */}
          <div className="flex flex-1 flex-col justify-center space-y-8">
            <div className="text-center">
              <div className="mb-8">
                <AuthBrandLogos />
              </div>
              <h1 className="font-['Poppins:Bold',sans-serif] text-5xl mb-4 leading-tight">
                ECOLOOP
              </h1>
              <p className="font-['Poppins:Regular',sans-serif] text-xl text-white/90 max-w-md mx-auto">
                Smart routing, real-time monitoring, and efficient waste collection for a cleaner Naga City.
              </p>
            </div>

            {/* Features */}
            <div className="flex items-center justify-center gap-3">
              <div className="flex items-center justify-center bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <div className="bg-white/20 rounded-lg p-3">
                  <Recycle className="size-8" />
                </div>
              </div>

              <div className="flex items-center justify-center bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <div className="bg-white/20 rounded-lg p-3">
                  <Shield className="size-8" />
                </div>
              </div>

              <div className="flex items-center justify-center bg-white/10 backdrop-blur-sm rounded-xl p-4">
                <div className="bg-white/20 rounded-lg p-3">
                  <Leaf className="size-8" />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="font-['Poppins:Regular',sans-serif] text-sm text-white/70">
            © 2025 ECOLOOP. All rights reserved.
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-gray-50 relative">
        {/* Back Button */}
        <button
          onClick={onBack}
          className="absolute top-6 left-6 flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="size-5" />
          <span className="font-['Poppins:Medium',sans-serif]">Back</span>
        </button>

        {/* Login Form */}
        <div className="w-full max-w-md mt-16 lg:mt-0">
          <div className="mb-6 lg:hidden">
            <AuthBrandLogos compact />
          </div>

          {/* Header */}
          <div className="text-center mb-8">
            <h2 className="font-['Poppins:Bold',sans-serif] text-3xl text-gray-900 mb-2">
              Welcome Back!
            </h2>
            <p className="font-['Poppins:Regular',sans-serif] text-gray-600">
              Sign in to continue to your dashboard
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
                {error}
              </div>
            )}
            {/* Email Field */}
            <div>
              <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-2">
                Email Address
              </label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-gray-400 group-focus-within:text-emerald-600 transition-colors" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Work email"
                  required
                  disabled={isSubmitting}
                  className="w-full h-14 pl-12 pr-4 bg-white border-2 border-gray-200 rounded-xl font-['Poppins:Regular',sans-serif] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100 transition-all"
                />
              </div>
              {email.length > 0 && !emailValid && <p className="mt-2 text-xs text-red-600">Invalid email format.</p>}
            </div>

            {/* Account Type */}
            <div>
              <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-2">
                Account Type
              </label>
              <CustomSelect
                value={role}
                onChange={(nextRole) => setRole(nextRole as WebLoginRole)}
                options={roleOptions}
                disabled={isSubmitting}
                buttonClassName="h-14 px-4 bg-white border-2 border-gray-200 rounded-xl font-['Poppins:Regular',sans-serif] text-gray-800 focus:outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100 transition-all"
                ariaLabel="Account type"
              />
            </div>

            {/* Password Field */}
            <div>
              <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-2">
                Password
              </label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-gray-400 group-focus-within:text-emerald-600 transition-colors" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  disabled={isSubmitting}
                  className="w-full h-14 pl-12 pr-12 bg-white border-2 border-gray-200 rounded-xl font-['Poppins:Regular',sans-serif] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </div>
              {password.length > 0 && !passwordValid && <p className="mt-2 text-xs text-red-600">Use at least 8 characters.</p>}
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500 focus:ring-2"
                />
                <span className="font-['Poppins:Regular',sans-serif] text-sm text-gray-700">
                  Remember me
                </span>
              </label>
              <button
                type="button"
                className="font-['Poppins:Medium',sans-serif] text-sm text-emerald-600 hover:text-emerald-700 hover:underline transition-colors"
              >
                Forgot password?
              </button>
            </div>

            {/* Login Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-14 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-70 disabled:cursor-not-allowed text-white rounded-xl font-['Poppins:SemiBold',sans-serif] transition-all shadow-lg shadow-emerald-600/30 hover:shadow-xl hover:shadow-emerald-600/40 hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {isSubmitting ? "Signing in..." : "Sign In"}
                <ArrowLeft className="size-5 rotate-180 group-hover:translate-x-1 transition-transform" />
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
            </button>

            {/* Divider */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="px-4 bg-gray-50 font-['Poppins:Regular',sans-serif] text-sm text-gray-500">
                  Don't have an account?
                </span>
              </div>
            </div>

            {/* Register Link */}
            <button
              type="button"
              onClick={onRegister}
              className="w-full h-14 bg-white border-2 border-gray-300 hover:border-emerald-600 text-gray-900 rounded-xl font-['Poppins:SemiBold',sans-serif] transition-all hover:bg-emerald-50 hover:scale-[1.02] active:scale-[0.98]"
            >
              Create New Account
            </button>
          </form>
              </div>
            </div>
          </div>
  );
}
