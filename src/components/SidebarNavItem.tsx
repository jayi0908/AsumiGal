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
        "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all text-left",
        active
          ? "bg-white text-indigo-600 shadow-md ring-1 ring-black/5 dark:bg-white/10 dark:text-white dark:ring-white/10"
          : "text-gray-600 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/5",
        className
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{label}</span>
      {children}
    </button>
  );
}
