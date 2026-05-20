import { useEffect, useRef, useState } from "react";
import { Mail, Lock, User as UserIcon, Phone, ArrowLeft, Eye, EyeOff } from "lucide-react";
import svgPaths from "../../assets/icons/ecoloopLogo";

interface RegisterPageFunctionalProps {
  onRegister: (params: {
    fullName: string;
    contactNumber: string;
    email: string;
    password: string;
    role: "admin" | "dispatcher" | "supervisor";
  }) => Promise<void>;
  onBack: () => void;
  onLoginClick: () => void;
}

export default function RegisterPageFunctional({ onRegister, onBack, onLoginClick }: RegisterPageFunctionalProps) {
  const [formData, setFormData] = useState({
    fullName: "",
    contactNumber: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "dispatcher" as "admin" | "dispatcher" | "supervisor",
    agreeToTerms: false,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim());
  const passwordLongEnough = formData.password.length >= 8;
  const passwordComplex = /[A-Za-z]/.test(formData.password) && /\d/.test(formData.password);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
    setError(null);
    setSuccess(null);
    if (!emailValid) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!passwordLongEnough || !passwordComplex) {
      setError("Password must be at least 8 characters and include letters and numbers.");
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!formData.agreeToTerms) {
      setError("Please agree to the terms and conditions.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onRegister({
        fullName: formData.fullName,
        contactNumber: formData.contactNumber,
        email: formData.email,
        password: formData.password,
        role: formData.role,
      });
      setSuccess("Your account has been submitted and is waiting for admin approval.");
      redirectTimerRef.current = setTimeout(() => {
        onLoginClick();
      }, 1800);
    } catch (err: any) {
      setError(err?.message ?? "Unable to create account.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative w-full min-h-screen overflow-y-auto bg-gradient-to-br from-emerald-400 via-teal-400 to-blue-400 flex flex-col items-center justify-center py-12 px-4">
      {/* Back Button */}
      <button
        onClick={onBack}
        className="absolute top-6 left-6 flex items-center gap-2 text-white hover:text-gray-100 transition-colors"
      >
        <ArrowLeft className="size-5" />
        <span className="font-['Poppins:Medium',sans-serif]">Back</span>
      </button>

      {/* Logo and Branding */}
      <div className="flex flex-col items-center mb-8">
        <div className="bg-white rounded-full p-6 mb-6 shadow-xl">
          <svg className="size-12" fill="none" viewBox="0 0 48 48">
            <g clipPath="url(#clip0_register)">
              <path d={svgPaths.p20737200} fill="#10b981" />
            </g>
            <defs>
              <clipPath id="clip0_register">
                <path d="M0 0H48V48H0V0Z" fill="white" />
              </clipPath>
            </defs>
          </svg>
        </div>
        
        <h1 className="font-['Poppins:Bold',sans-serif] text-4xl text-white mb-2">
          Join ECOLOOP
        </h1>
        <p className="font-['Poppins:Regular',sans-serif] text-lg text-white/90">
          Create your account to get started
        </p>
      </div>

      {/* Register Form Card */}
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 mb-8">
        <form onSubmit={handleSubmit}>
          {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>}
          {success && <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 text-sm">{success}</div>}
          {/* Full Name */}
          <div className="mb-4">
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-2">
              Full Name
            </label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-400" />
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                placeholder="Enter your full name"
                required
                disabled={isSubmitting}
                className="w-full h-12 pl-11 pr-4 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Contact Number */}
          <div className="mb-4">
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-2">
              Contact Number
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-400" />
              <input
                type="tel"
                value={formData.contactNumber}
                onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                placeholder="Mobile number"
                required
                disabled={isSubmitting}
                className="w-full h-12 pl-11 pr-4 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Email */}
          <div className="mb-4">
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-2">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-400" />
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Work email"
                required
                disabled={isSubmitting}
                className="w-full h-12 pl-11 pr-4 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
            </div>
            {formData.email.length > 0 && !emailValid && <p className="mt-2 text-xs text-red-600">Invalid email format.</p>}
          </div>

          {/* Account Type (Web only roles) */}
          <div className="mb-4">
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-2">
              Account Type
            </label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as "admin" | "dispatcher" | "supervisor" })}
              required
              disabled={isSubmitting}
              className="w-full h-12 px-4 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
            >
              <option value="admin">Admin</option>
              <option value="dispatcher">Dispatcher</option>
              <option value="supervisor">Supervisor</option>
            </select>
          </div>

          {/* Password */}
          <div className="mb-4">
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Create a strong password"
                required
                disabled={isSubmitting}
                className="w-full h-12 pl-11 pr-4 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 size-5 text-gray-400"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
            {formData.password.length > 0 && (!passwordLongEnough || !passwordComplex) && (
              <p className="mt-2 text-xs text-red-600">Use 8+ chars with letters and numbers.</p>
            )}
          </div>

          {/* Confirm Password */}
          <div className="mb-5">
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-2">
              Confirm Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-gray-400" />
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                placeholder="Confirm your password"
                required
                disabled={isSubmitting}
                className="w-full h-12 pl-11 pr-4 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 size-5 text-gray-400"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
              >
                {showConfirmPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>

          {/* Terms Checkbox */}
          <div className="flex items-start gap-3 mb-6">
            <input
              type="checkbox"
              id="terms"
              checked={formData.agreeToTerms}
              onChange={(e) => setFormData({ ...formData, agreeToTerms: e.target.checked })}
              className="mt-1 w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
            />
            <label htmlFor="terms" className="font-['Poppins:Regular',sans-serif] text-sm text-gray-600 leading-tight">
              I agree to the{" "}
              <span className="font-['Poppins:Medium',sans-serif] text-emerald-600 cursor-pointer hover:underline">
                Terms & Conditions
              </span>
              {" "}and{" "}
              <span className="font-['Poppins:Medium',sans-serif] text-emerald-600 cursor-pointer hover:underline">
                Privacy Policy
              </span>
            </label>
          </div>

          {/* Create Account Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-[52px] bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-70 disabled:cursor-not-allowed text-white rounded-xl font-['Poppins:SemiBold',sans-serif] text-base transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group mb-3"
          >
            <span className="relative z-10">{isSubmitting ? "Creating..." : "Create Account"}</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
          </button>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 bg-white font-['Poppins:Regular',sans-serif] text-sm text-gray-500">
                Already have an account?
              </span>
            </div>
          </div>

          {/* Login Button */}
          <button
            type="button"
            onClick={onLoginClick}
            disabled={isSubmitting}
            className="w-full h-[52px] bg-sky-500 hover:bg-sky-600 active:bg-sky-700 disabled:opacity-70 disabled:cursor-not-allowed text-white rounded-xl font-['Poppins:SemiBold',sans-serif] text-base transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group"
          >
            <span className="relative z-10">Login to Account</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
          </button>
        </form>
      </div>

      {/* Footer Info */}
      <div className="mb-8 text-center">
        <p className="font-['Poppins:Regular',sans-serif] text-sm text-white/80">
          © 2025 ECOLOOP - Naga City System
        </p>
      </div>
    </div>
  );
}