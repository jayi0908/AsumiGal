import { ReactNode } from "react";
import clsx from "clsx";

interface TooltipProps {
  label: string;
  children: ReactNode;
  position?: 'top' | 'bottom';
}

export function Tooltip({ label, children, position = 'bottom' }: TooltipProps) {
  return (
    <div className="relative inline-flex group/tip">
      {children}
      <span
        className={clsx(
          "pointer-events-none absolute z-[70] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 text-white text-xs px-2.5 py-1 shadow-lg opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150",
          position === 'top' ? "bottom-full mb-2" : "top-full mt-2"
        )}
      >
        {label}
      </span>
    </div>
  );
}
