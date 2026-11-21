import { ReactNode } from "react";
import clsx from "clsx";

interface SidebarNavItemProps {
  active?: boolean;
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}

export function SidebarNavItem({
  active = false,
  icon,
  label,
  onClick,
  className,
  children,
}: SidebarNavItemProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all text-left",
        active
          ? "bg-indigo-500/10 text-indigo-600 ring-1 ring-indigo-500/20 dark:bg-indigo-500/20 dark:text-indigo-200 dark:ring-indigo-400/25 shadow-sm"
          : "text-slate-600 dark:text-slate-300/75 hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05] hover:text-slate-900 dark:hover:text-white",
        className
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{label}</span>
      {children}
    </button>
  );
}
