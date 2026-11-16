import React from 'react';

interface GemIconProps {
  className?: string;
}

export const TanzaniteGemIcon: React.FC<GemIconProps> = ({ className = 'w-7 h-7' }) => (
  <svg
    viewBox="0 0 512 512"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="tb-outer" x1="64" y1="64" x2="448" y2="460" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#3B82F6" />
        <stop offset="45%" stopColor="#2B3A9F" />
        <stop offset="100%" stopColor="#6D28D9" />
      </linearGradient>
      <linearGradient id="tb-table" x1="160" y1="120" x2="350" y2="340" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#60A5FA" />
        <stop offset="50%" stopColor="#3730A3" />
        <stop offset="100%" stopColor="#7C3AED" />
      </linearGradient>
      <linearGradient id="tb-left" x1="48" y1="100" x2="256" y2="462" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#1E40AF" />
        <stop offset="100%" stopColor="#4C1D95" />
      </linearGradient>
      <linearGradient id="tb-right" x1="464" y1="100" x2="256" y2="462" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#4F46E5" />
        <stop offset="100%" stopColor="#5B21B6" />
      </linearGradient>
    </defs>
    <polygon points="48,116 112,72 400,72 464,116 256,464" fill="url(#tb-outer)" />
    <polygon points="112,72 400,72 346,136 166,136" fill="#93C5FD" fillOpacity="0.88" />
    <polygon points="48,116 112,72 166,136 118,176" fill="#6366F1" />
    <polygon points="400,72 464,116 394,176 346,136" fill="#A78BFA" />
    <polygon points="48,116 118,176 256,368 256,464" fill="url(#tb-left)" />
    <polygon points="464,116 394,176 256,368 256,464" fill="url(#tb-right)" />
    <polygon points="118,176 166,136 256,368" fill="#4338CA" />
    <polygon points="394,176 346,136 256,368" fill="#7C3AED" />
    <polygon points="166,136 346,136 256,368" fill="url(#tb-table)" />
    <polygon points="166,136 256,136 256,256" fill="#BFDBFE" fillOpacity="0.42" />
    <polygon points="256,136 346,136 256,256" fill="#DDD6FE" fillOpacity="0.34" />
    <polygon points="196,156 244,156 218,224" fill="#FFFFFF" fillOpacity="0.45" />
    <path
      d="M48 116L112 72H400L464 116L256 464L48 116Z M112 72L166 136M400 72L346 136M48 116L118 176M464 116L394 176M166 136H346L256 368L166 136ZM118 176L256 368M394 176L256 368M256 368V464"
      stroke="#E0E7FF"
      strokeOpacity="0.6"
      strokeWidth="6"
      strokeLinejoin="round"
    />
  </svg>
);

interface TanzaniteLogoProps {
  compact?: boolean;
  inverted?: boolean;
  iconClassName?: string;
  wordmarkClassName?: string;
}

export const TanzaniteLogo: React.FC<TanzaniteLogoProps> = ({
  compact = false,
  inverted = false,
  iconClassName = 'w-6 h-6 sm:w-7 sm:h-7 shrink-0',
  wordmarkClassName = 'font-editorial text-base sm:text-2xl font-semibold tracking-tight whitespace-nowrap truncate',
}) => (
  <span className="inline-flex items-center gap-1.5 sm:gap-2 min-w-0 max-w-full">
    <TanzaniteGemIcon className={iconClassName} />
    {!compact && (
      <span className={`${wordmarkClassName} ${inverted ? 'text-white' : 'text-[#111322]'}`}>
        TANZANITE EXPRESS
      </span>
    )}
  </span>
);
