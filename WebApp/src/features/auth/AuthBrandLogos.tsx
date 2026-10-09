import svgPaths from "../../assets/icons/ecoloopLogo";
import nagaOfficialSeal from "../../assets/images/naga-official-seal.jpg";
import swmoLogo from "../../assets/images/swmo-logo.jpg";

interface AuthBrandLogosProps {
  compact?: boolean;
}

export default function AuthBrandLogos({ compact = false }: AuthBrandLogosProps) {
  const logoClass = compact ? "size-11" : "size-16 sm:size-20";
  const iconClass = compact ? "size-7" : "size-8 sm:size-10";

  return (
    <div className="flex items-center justify-center gap-3 sm:gap-5" aria-label="EcoLoop and City of Naga logos">
      <img
        src={nagaOfficialSeal}
        alt="City of Naga official seal"
        className={`${logoClass} rounded-full bg-white object-cover shadow-xl`}
      />
      <div className={`${logoClass} flex items-center justify-center rounded-full bg-white shadow-xl`}>
        <svg className={iconClass} fill="none" viewBox="0 0 48 48" role="img" aria-label="EcoLoop logo">
          <path d={svgPaths.p20737200} fill="#10b981" />
        </svg>
      </div>
      <img
        src={swmoLogo}
        alt="Solid Waste Management Office Naga City logo"
        className={`${logoClass} rounded-full bg-white object-cover shadow-xl`}
      />
    </div>
  );
}
