import { useState } from "react";
import { MapPin, Bell, Users, Shield } from "lucide-react";
import svgPaths from "../../assets/icons/ecoloopLogo";
import LoginPageFunctional from "./LoginPageFunctional";
import { useAuth } from "../../contexts/AuthContext";

interface WelcomeScreenProps {
  initialError?: string | null;
}

export default function WelcomeScreen({ initialError }: WelcomeScreenProps) {
  const [screen, setScreen] = useState<"welcome" | "login">("welcome");
  const { authError, signIn } = useAuth();

  if (screen === "welcome") {
    return (
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-y-auto bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 px-4 py-10">
        <div className="relative z-10 flex w-full max-w-xl flex-col items-center rounded-2xl border border-white/15 bg-white/10 p-6 sm:p-10 backdrop-blur-sm">
          <div className="mb-6 rounded-2xl bg-white p-5 shadow-lg">
            <svg className="size-12 sm:size-14" fill="none" viewBox="0 0 48 48" aria-hidden="true">
              <g clipPath="url(#clip0_welcome)">
                <path d={svgPaths.p20737200} fill="#059669" />
              </g>
              <defs>
                <clipPath id="clip0_welcome">
                  <path d="M0 0H48V48H0V0Z" fill="white" />
                </clipPath>
              </defs>
            </svg>
          </div>

          <h1 className="mb-2 text-center text-3xl font-bold tracking-tight text-white sm:text-5xl">
            EcoLoop
          </h1>
          <p className="mb-1 text-center text-base font-medium text-white/95 sm:text-xl">
            Waste Collection Routing &amp; Fleet Operations
          </p>
          <p className="mb-8 text-center text-sm text-emerald-100">
            City of Naga Solid Waste Management Office
          </p>

          <div className="mb-8 grid w-full grid-cols-3 gap-3 sm:gap-6">
            <div className="flex flex-col items-center rounded-xl border border-white/15 bg-white/10 px-2 py-3.5 text-center">
              <MapPin className="mb-2 size-5 text-white sm:size-6" aria-hidden="true" />
              <p className="text-xs font-medium text-white sm:text-sm">Route Tracking</p>
            </div>

            <div className="flex flex-col items-center rounded-xl border border-white/15 bg-white/10 px-2 py-3.5 text-center">
              <Bell className="mb-2 size-5 text-white sm:size-6" aria-hidden="true" />
              <p className="text-xs font-medium text-white sm:text-sm">Smart Alerts</p>
            </div>

            <div className="flex flex-col items-center rounded-xl border border-white/15 bg-white/10 px-2 py-3.5 text-center">
              <Users className="mb-2 size-5 text-white sm:size-6" aria-hidden="true" />
              <p className="text-xs font-medium text-white sm:text-sm">Fleet Ops</p>
            </div>
          </div>

          <div className="flex w-full max-w-md flex-col gap-3">
            {(initialError || authError) && (
              <div className="rounded-xl border border-red-200 bg-white p-3 text-sm font-medium text-red-800 shadow-xs">
                {initialError || authError}
              </div>
            )}
            <button
              type="button"
              onClick={() => setScreen("login")}
              className="min-h-[48px] w-full rounded-xl bg-white px-5 py-3 text-base font-semibold text-emerald-800 shadow-md transition-colors hover:bg-emerald-50 active:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-700"
            >
              Sign In to Staff Portal
            </button>

            <div className="flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-center text-xs text-emerald-50">
              <Shield className="size-4 shrink-0 text-emerald-200" aria-hidden="true" />
              <span>Authorized SWMO Personnel Only · Accounts are provisioned by an Administrator</span>
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className="text-xs text-emerald-100/90">
              © 2026 EcoLoop · City of Naga SWMO
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <LoginPageFunctional
      onLogin={signIn}
      onBack={() => setScreen("welcome")}
    />
  );
}
