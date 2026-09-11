"use client";

import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  MotionValue,
  AnimatePresence,
} from "framer-motion";
import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function useDockItemTransform(
  mouseX: MotionValue<number>,
  distance: number,
  ref: React.RefObject<HTMLDivElement>,
  spring: { mass: number; stiffness: number; damping: number }
) {
  const baseCenterRef = useRef<number | null>(null);

  useEffect(() => {
    const handleReset = () => {
      baseCenterRef.current = null;
    };
    window.addEventListener("resize", handleReset);
    window.addEventListener("scroll", handleReset, { passive: true });
    return () => {
      window.removeEventListener("resize", handleReset);
      window.removeEventListener("scroll", handleReset);
    };
  }, []);

  const mouseDistance = useTransform(mouseX, (val) => {
    if (typeof val !== "number" || isNaN(val) || !isFinite(val)) {
      baseCenterRef.current = null;
      return Infinity;
    }

    let center = baseCenterRef.current;
    if (center === null && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      center = rect.left + rect.width / 2;
      baseCenterRef.current = center;
    }

    return val - (center ?? 0);
  });

  // Scale: resting at 1, popping 10% (1.10) when cursor is centered
  const targetScale = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [1, 1.10, 1]
  );

  // Subtle Y lift: resting at 0, popping up by -3px when centered
  const targetY = useTransform(
    mouseDistance,
    [-distance, 0, distance],
    [0, -3, 0]
  );

  const scale = useSpring(targetScale, spring);
  const y = useSpring(targetY, spring);

  return { scale, y };
}

export interface DockItem {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  onMouseEnter?: () => void;
  badgeCount?: number;
  isActive?: boolean;
  isDisabled?: boolean;
  isSeparatorBefore?: boolean;
}

interface DockItemComponentProps extends DockItem {
  mouseX: MotionValue<number>;
  baseItemSize: number;
  distance: number;
  spring: { mass: number; stiffness: number; damping: number };
  onHoverItem: (label: string | null) => void;
}

function DockItemComponent({
  icon,
  label,
  onClick,
  onMouseEnter,
  badgeCount,
  isActive,
  isDisabled,
  mouseX,
  baseItemSize,
  distance,
  spring,
  onHoverItem,
}: DockItemComponentProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scale, y } = useDockItemTransform(mouseX, distance, ref, spring);

  return (
    <div
      ref={ref}
      style={{ width: baseItemSize, height: baseItemSize }}
      className="relative flex shrink-0 items-center justify-center"
    >
      <motion.button
        style={{
          width: baseItemSize,
          height: baseItemSize,
          scale: isDisabled ? 1 : scale,
          y: isDisabled ? 0 : y,
        }}
        whileTap={isDisabled ? undefined : { scale: 0.95 }}
        onHoverStart={() => {
          onHoverItem(label);
          onMouseEnter?.();
        }}
        onHoverEnd={() => onHoverItem(null)}
        onFocus={() => {
          onHoverItem(label);
          onMouseEnter?.();
        }}
        onBlur={() => onHoverItem(null)}
        onClick={isDisabled ? undefined : onClick}
        className={cn(
          "relative flex items-center justify-center rounded-[12px] sm:rounded-[14px] transition-colors duration-150 select-none cursor-pointer",
          "bg-[#1a1a20]/90 hover:bg-[#252530] border border-white/[0.06] hover:border-white/[0.16]",
          "text-neutral-300 hover:text-white shadow-xs",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30",
          isActive && [
            "bg-gradient-to-b from-white/[0.20] to-white/[0.10] border-white/30 text-white",
            "shadow-[0_0_12px_rgba(255,255,255,0.15),inset_0_1px_1px_rgba(255,255,255,0.25)]",
          ],
          isDisabled && "opacity-40 cursor-not-allowed hover:bg-[#1a1a20]/90 hover:border-white/[0.06] hover:text-neutral-400"
        )}
        tabIndex={isDisabled ? -1 : 0}
        aria-label={label}
        title={label}
      >
        <div
          className={cn(
            "flex items-center justify-center [&_svg]:h-[18px] [&_svg]:w-[18px] sm:[&_svg]:h-[19px] sm:[&_svg]:w-[19px] [&_svg]:stroke-[1.8] pointer-events-none transition-transform duration-150",
            isActive && "[&_svg]:drop-shadow-[0_0_6px_rgba(255,255,255,0.6)] text-white"
          )}
        >
          {icon}
        </div>

        {badgeCount !== undefined && badgeCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[9px] font-mono font-bold text-black bg-white rounded-full shadow-md ring-1 ring-[#121215]">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}

        {isActive && (
          <span className="absolute bottom-1 w-1 h-1 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
        )}
      </motion.button>
    </div>
  );
}

export interface DockProps {
  items: DockItem[];
  className?: string;
  spring?: { mass: number; stiffness: number; damping: number };
  distance?: number;
  baseItemSize?: number;
}

export default function Dock({
  items,
  className = "",
  spring = { mass: 0.1, stiffness: 400, damping: 25 },
  distance = 70,
  baseItemSize = 38,
}: DockProps) {
  const mouseX = useMotionValue(Infinity);
  const [compactDock, setCompactDock] = useState(false);
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse), (max-width: 640px)");
    const update = () => setCompactDock(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const effectiveBaseItemSize = compactDock ? 34 : baseItemSize;
  const effectiveDistance = compactDock ? 0 : distance;

  const activeItem = items.find((i) => i.isActive);
  const displayLabel = hoveredLabel ?? activeItem?.label ?? null;

  return (
    <div className="flex flex-col items-center select-none pointer-events-auto">
      {/* Fixed Dock Pill Background Container */}
      <div
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => {
          mouseX.set(Infinity);
          setHoveredLabel(null);
        }}
        className={cn(
          "flex items-center gap-1.5 sm:gap-2 px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-full h-[50px] sm:h-[52px]",
          "bg-[#121215]/90 dark:bg-[#0c0c10]/95 backdrop-blur-2xl",
          "border border-white/[0.08] dark:border-white/[0.10]",
          "shadow-[0_16px_40px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.04),inset_0_1px_1px_rgba(255,255,255,0.10)]",
          "ring-1 ring-black/40",
          "overflow-visible",
          className
        )}
        role="toolbar"
        aria-label="Application dock"
      >
        {items.map((item, index) => (
          <React.Fragment key={item.label || index}>
            {item.isSeparatorBefore && (
              <div className="h-5 w-[1px] bg-white/[0.12] mx-0.5 sm:mx-1 shrink-0 rounded-full" />
            )}
            <DockItemComponent
              {...item}
              mouseX={mouseX}
              baseItemSize={effectiveBaseItemSize}
              distance={effectiveDistance}
              spring={spring}
              onHoverItem={setHoveredLabel}
            />
          </React.Fragment>
        ))}
      </div>

      {/* Dynamic label underneath dock */}
      <div className="h-5 flex items-center justify-center pointer-events-none mt-1">
        <AnimatePresence mode="wait">
          {displayLabel && (
            <motion.span
              key={displayLabel}
              initial={{ opacity: 0, y: -2, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -1, scale: 0.96 }}
              transition={{ duration: 0.08, ease: "easeOut" }}
              className="text-[11px] font-medium text-neutral-300 tracking-wide drop-shadow-sm"
            >
              {displayLabel}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}


