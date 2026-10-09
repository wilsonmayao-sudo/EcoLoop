import { useState } from "react";
import { MapPin, Bell, Users } from "lucide-react";
import svgPaths from "../../assets/icons/ecoloopLogo";
import LoginPageFunctional from "./LoginPageFunctional";
import RegisterPageFunctional from "./RegisterPageFunctional";
import { useAuth } from "../../contexts/AuthContext";

interface WelcomeScreenProps {
  initialError?: string | null;
}

export default function WelcomeScreen({ initialError }: WelcomeScreenProps) {
  const [screen, setScreen] = useState<"welcome" | "login" | "register">("welcome");
  const { authError, signIn, signUp } = useAuth();

  // Show welcome screen
  if (screen === "welcome") {
    return (
      <div className="relative w-full h-screen overflow-hidden bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 flex items-center justify-center">
        {/* Animated Background */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-white/10 rounded-full blur-3xl animate-pulse"></div>
          <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-white/10 rounded-full blur-3xl animate-pulse delay-700"></div>
        </div>

        {/* Main Content */}
        <div className="relative z-10 flex flex-col items-center max-w-2xl px-6">
          {/* Logo */}
          <div className="bg-white rounded-full p-8 mb-8 shadow-2xl backdrop-blur-sm">
            <svg className="size-16" fill="none" viewBox="0 0 48 48">
              <g clipPath="url(#clip0_welcome)">
                <path d={svgPaths.p20737200} fill="#10b981" />
              </g>
              <defs>
                <clipPath id="clip0_welcome">
                  <path d="M0 0H48V48H0V0Z" fill="white" />
                </clipPath>
              </defs>
            </svg>
          </div>
          
          {/* Title */}
          <h1 className="font-['Poppins:Bold',sans-serif] text-6xl text-white mb-4 text-center">
            ECOLOOP
          </h1>
          <p className="font-['Poppins:Regular',sans-serif] text-2xl text-white/90 mb-4 text-center">
            Waste Collection Routing and Fleet Operations
          </p>
          <p className="font-['Poppins:Regular',sans-serif] text-lg text-white/80 mb-16 text-center">
           City of Naga
          </p>

          {/* Features Grid */}
          <div className="grid grid-cols-3 gap-8 mb-12 w-full max-w-xl">
            <div className="flex flex-col items-center">
              <div className="bg-white/20 rounded-full p-5 mb-3 backdrop-blur-sm">
                <MapPin className="size-7 text-white" />
              </div>
              <p className="font-['Poppins:Medium',sans-serif] text-sm text-white text-center">
                Route Tracking
              </p>
            </div>

            <div className="flex flex-col items-center">
              <div className="bg-white/20 rounded-full p-5 mb-3 backdrop-blur-sm">
                <Bell className="size-7 text-white" />
              </div>
              <p className="font-['Poppins:Medium',sans-serif] text-sm text-white text-center">
                Smart Alerts
              </p>
            </div>

            <div className="flex flex-col items-center">
              <div className="bg-white/20 rounded-full p-5 mb-3 backdrop-blur-sm">
                <Users className="size-7 text-white" />
              </div>
              <p className="font-['Poppins:Medium',sans-serif] text-sm text-white text-center">
                Community
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-4 w-full max-w-md">
            {(initialError || authError) && (
              <div className="bg-white/90 text-red-700 border border-red-200 rounded-xl p-3 text-sm">
                {initialError || authError}
              </div>
            )}
            <button
              onClick={() => setScreen("login")}
              className="h-[52px] bg-white hover:bg-emerald-50 active:bg-emerald-100 rounded-xl font-['Poppins:SemiBold',sans-serif] text-base text-emerald-700 transition-all shadow-xl hover:shadow-2xl hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group"
            >
              <span className="relative z-10">Login to Account</span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-100/70 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
            </button>
            
            <button
              onClick={() => setScreen("register")}
              className="h-[52px] bg-white/10 hover:bg-white/20 active:bg-white/25 border-2 border-white rounded-xl font-['Poppins:SemiBold',sans-serif] text-base text-white transition-all shadow-xl hover:shadow-2xl hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group"
            >
              <span className="relative z-10">Register New Account</span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
            </button>
          </div>

          {/* Footer */}
          <div className="mt-12 text-center">
            <p className="font-['Poppins:Regular',sans-serif] text-sm text-white/70">
              © 2025 ECOLOOP System. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show login screen
  if (screen === "login") {
    return (
      <LoginPageFunctional
        onLogin={signIn}
        onRegister={() => setScreen("register")}
        onBack={() => setScreen("welcome")}
      />
    );
  }

  // Show register screen
  if (screen === "register") {
    return (
      <RegisterPageFunctional
        onRegister={signUp}
        onBack={() => setScreen("welcome")}
        onLoginClick={() => setScreen("login")}
      />
    );
  }

  return null;
}
