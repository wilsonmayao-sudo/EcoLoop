import { useEffect, useRef, useState } from "react";
import { Mail, Lock, User as UserIcon, Phone, ArrowLeft, Eye, EyeOff } from "lucide-react";
import CustomSelect from "../../components/ui/CustomSelect";
import AuthBrandLogos from "./AuthBrandLogos";

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

const roleOptions = [
  { value: "admin", label: "Admin" },
  { value: "dispatcher", label: "Dispatcher" },
  { value: "supervisor", label: "Supervisor" },
];

export default function RegisterPageFunctional({ onRegister, onBack, onLoginClick }: RegisterPageFunctionalProps) {
  const [legalModal, setLegalModal] = useState<"terms" | "privacy" | null>(null);
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
    <div className="relative w-full min-h-screen overflow-y-auto bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 flex flex-col items-center justify-start pt-5 sm:pt-8 pb-4 px-4">
      {/* Back Button */}
      <button
        onClick={onBack}
        className="absolute top-4 left-4 sm:top-6 sm:left-6 flex items-center gap-2 text-white hover:text-gray-100 transition-colors"
      >
        <ArrowLeft className="size-5" />
        <span className="font-['Poppins:Medium',sans-serif]">Back</span>
      </button>

      {/* Logo and Branding */}
      <div className="flex flex-col items-center mb-9">
        <div className="mb-3">
          <AuthBrandLogos />
        </div>
        
        <h1 className="font-['Poppins:Bold',sans-serif] text-3xl sm:text-4xl text-white leading-tight">
          Join ECOLOOP
        </h1>
        <p className="font-['Poppins:Regular',sans-serif] text-base sm:text-lg text-white/90 text-center leading-tight">
          Create your account to get started
        </p>
      </div>

      {/* Register Form Card */}
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl p-6 sm:p-8 mb-4">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
          {error && <div className="sm:col-span-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5 text-sm">{error}</div>}
          {success && <div className="sm:col-span-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-2.5 text-sm">{success}</div>}
          {/* Full Name */}
          <div>
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-1">
              Full Name
            </label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                placeholder="Enter your full name"
                required
                disabled={isSubmitting}
                className="w-full h-11 pl-10 pr-3 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Contact Number */}
          <div>
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-1">
              Contact Number
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
              <input
                type="tel"
                value={formData.contactNumber}
                onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                placeholder="Mobile number"
                required
                disabled={isSubmitting}
                className="w-full h-11 pl-10 pr-3 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-1">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Work email"
                required
                disabled={isSubmitting}
                className="w-full h-11 pl-10 pr-3 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
            </div>
            {formData.email.length > 0 && !emailValid && <p className="mt-1 text-xs text-red-600">Invalid email format.</p>}
          </div>

          {/* Account Type (Web only roles) */}
          <div>
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-1">
              Account Type
            </label>
            <CustomSelect
              value={formData.role}
              onChange={(role) => setFormData({ ...formData, role: role as "admin" | "dispatcher" | "supervisor" })}
              options={roleOptions}
              disabled={isSubmitting}
              buttonClassName="h-11 px-3 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              ariaLabel="Account type"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Create a strong password"
                required
                disabled={isSubmitting}
                className="w-full h-11 pl-10 pr-10 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-gray-400"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
            {formData.password.length > 0 && (!passwordLongEnough || !passwordComplex) && (
              <p className="mt-1 text-xs text-red-600">Use 8+ chars with letters and numbers.</p>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block font-['Poppins:Medium',sans-serif] text-sm text-gray-700 mb-1">
              Confirm Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                placeholder="Confirm your password"
                required
                disabled={isSubmitting}
                className="w-full h-11 pl-10 pr-10 bg-white border border-gray-300 rounded-lg font-['Poppins:Regular',sans-serif] text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-gray-400"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
              >
                {showConfirmPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </div>

          {/* Terms Checkbox */}
          <div className="sm:col-span-2 flex items-start gap-2">
            <input
              type="checkbox"
              id="terms"
              checked={formData.agreeToTerms}
              onChange={(e) => setFormData({ ...formData, agreeToTerms: e.target.checked })}
              className="mt-1 w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
            />
            <div className="font-['Poppins:Regular',sans-serif] text-xs sm:text-sm text-gray-600 leading-tight">
              <label htmlFor="terms">I agree to the </label>
              <button
                type="button"
                onClick={() => setLegalModal("terms")}
                className="font-['Poppins:Medium',sans-serif] text-emerald-600 hover:underline"
              >
                Terms & Conditions
              </button>
              {" "}and{" "}
              <button
                type="button"
                onClick={() => setLegalModal("privacy")}
                className="font-['Poppins:Medium',sans-serif] text-emerald-600 hover:underline"
              >
                Privacy Policy
              </button>
              .
            </div>
          </div>

          {/* Create Account Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="sm:col-span-2 w-full h-12 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-70 disabled:cursor-not-allowed text-white rounded-xl font-['Poppins:SemiBold',sans-serif] text-sm transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group"
          >
            <span className="relative z-10">{isSubmitting ? "Creating..." : "Create Account"}</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
          </button>

          <div className="sm:col-span-2 text-center font-['Poppins:Regular',sans-serif] text-xs sm:text-sm text-gray-500">
            Already have an account?{" "}
            <button
              type="button"
              onClick={onLoginClick}
              disabled={isSubmitting}
              className="font-['Poppins:Medium',sans-serif] text-emerald-600 hover:text-emerald-700 hover:underline disabled:opacity-70 disabled:cursor-not-allowed"
            >
              Login to Account
            </button>
          </div>
        </form>
      </div>

      {/* Footer Info */}
      <div className="mb-2 text-center">
        <p className="font-['Poppins:Regular',sans-serif] text-sm text-white/80">
          © 2025 ECOLOOP - Naga City System
        </p>
      </div>

      {legalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="font-['Poppins:Bold',sans-serif] text-xl text-gray-900">
              {legalModal === "terms" ? "Terms and Conditions" : "Privacy Policy"}
            </h2>
            <p className="mt-3 font-['Poppins:Regular',sans-serif] text-sm leading-relaxed text-gray-600">
              {legalModal === "terms"
                ? "Use this account only for authorized ECOLOOP waste collection and fleet operations. Provide accurate registration details, keep your login credentials private, follow administrator instructions, and do not attempt unauthorized access. Misuse, false information, or security violations may result in account suspension or removal."
                : "ECOLOOP uses your name, contact number, email, role, and account status for registration, approval, authentication, support, and system administration. Your information is accessible only to authorized administrators and required service providers, and is handled for legitimate ECOLOOP operations."}
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setLegalModal(null)}
                className="rounded-lg bg-emerald-600 px-5 py-2 font-['Poppins:SemiBold',sans-serif] text-sm text-white transition-colors hover:bg-emerald-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
