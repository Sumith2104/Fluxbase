"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface FluxAiIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  variant?: "gradient" | "monochrome";
  className?: string;
}

export function FluxAiIcon({
  size = 16,
  variant = "gradient",
  className,
  ...props
}: FluxAiIconProps) {
  const id = React.useId().replace(/:/g, "-");

  if (variant === "monochrome") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("shrink-0", className)}
        {...props}
      >
        <path
          d="M12 2C12 7.52285 7.52285 12 2 12C7.52285 12 12 16.4771 12 22C12 16.4771 16.4771 12 22 12C16.4771 12 12 7.52285 12 2Z"
          fill="currentColor"
        />
        <circle cx="19.5" cy="4.5" r="1.5" fill="currentColor" opacity="0.8" />
        <circle cx="4.5" cy="19.5" r="1.5" fill="currentColor" opacity="0.8" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient
          id={`flux-ai-grad-${id}`}
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
        <linearGradient
          id={`flux-ai-core-${id}`}
          x1="8"
          y1="8"
          x2="16"
          y2="16"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#c7d2fe" />
        </linearGradient>
        <filter id={`flux-ai-glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="1.5" floodColor="#818cf8" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* Main geometric astroid flare */}
      <path
        d="M12 2C12 7.52285 7.52285 12 2 12C7.52285 12 12 16.4771 12 22C12 16.4771 16.4771 12 22 12C16.4771 12 12 7.52285 12 2Z"
        fill={`url(#flux-ai-grad-${id})`}
        filter={`url(#flux-ai-glow-${id})`}
      />

      {/* Inner high-illumination core */}
      <path
        d="M12 6.5C12 9.53757 9.53757 12 6.5 12C9.53757 12 12 14.4624 12 17.5C12 14.4624 14.4624 12 17.5 12C14.4624 12 12 9.53757 12 6.5Z"
        fill={`url(#flux-ai-core-${id})`}
      />

      {/* Precision satellite sparks */}
      <circle cx="19.5" cy="4.5" r="1.5" fill="#38bdf8" />
      <circle cx="4.5" cy="19.5" r="1.5" fill="#c084fc" />
    </svg>
  );
}

export default FluxAiIcon;
