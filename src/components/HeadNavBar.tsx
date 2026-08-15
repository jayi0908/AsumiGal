// Derived from SJMCL (https://github.com/UNIkeEN/SJMCL), GPL-3.0.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { Box, Compass, Play, Search, Settings, RefreshCw } from "lucide-react";
import AdvancedCard from "./AdvancedCard";
import { useTheme } from "../contexts/ThemeContext";
import styles from "../styles/head-navbar.module.css";
import animationStyles from "../styles/animations.module.css";
import clsx from "clsx";

interface HeadNavBarProps {
  activeTab: "home" | "instances" | "discovery" | "settings";
  setActiveTab: (tab: "home" | "instances" | "discovery" | "settings") => void;
  onRefresh?: () => void;
  onOpenSearch?: () => void;
}

const HeadNavBar = ({
  activeTab,
  setActiveTab,
  onRefresh,
  onOpenSearch,
}: HeadNavBarProps) => {
  const { config, currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  const [isAnimating, setIsAnimating] = useState(false);
  const [indicator, setIndicator] = useState({
    left: 0,
    width: 0,
    visible: false,
  });
  const navListRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const indicatorBg = isDark
    ? "rgba(99, 102, 241, 0.35)"
    : "rgba(199, 210, 254, 0.9)";
  const indicatorBorder = isDark
    ? "rgba(129, 140, 248, 0.6)"
    : "rgba(165, 180, 252, 0.9)";
  const hoverBg = isDark
    ? "rgba(255, 255, 255, 0.08)"
    : "rgba(79, 70, 229, 0.08)";

  const navList = useMemo(() => {
    const list: {
      icon: typeof Play;
      label: string;
      key: "home" | "instances" | "discovery" | "settings" | "search";
    }[] = [
      { icon: Play, label: "启动", key: "home" },
      { icon: Box, label: "实例", key: "instances" },
    ];
    if (config.enableDiscovery) {
      list.push({ icon: Compass, label: "发现", key: "discovery" });
    } else {
      list.push({ icon: Search, label: "搜索", key: "search" });
    }
    list.push({ icon: Settings, label: "设置", key: "settings" });
    return list;
  }, [config.enableDiscovery]);

  useEffect(() => {
    setIsAnimating(true);
    const timer = setTimeout(() => setIsAnimating(false), 700);
    return () => clearTimeout(timer);
  }, [isDark]);

  const selectedIndex = navList.findIndex((item) => item.key === activeTab);

  const updateIndicator = useCallback(() => {
    if (selectedIndex < 0) {
      setIndicator((prev) =>
        prev.visible ? { ...prev, visible: false } : prev
      );
      return;
    }

    const listEl = navListRef.current;
    const selectedEl = tabRefs.current[selectedIndex];
    if (!listEl || !selectedEl) {
      setIndicator((prev) =>
        prev.visible ? { ...prev, visible: false } : prev
      );
      return;
    }

    const listRect = listEl.getBoundingClientRect();
    const tabRect = selectedEl.getBoundingClientRect();
    const nextLeft = Math.round(tabRect.left - listRect.left);
    const nextWidth = Math.round(tabRect.width);

    setIndicator((prev) => {
      if (prev.visible && prev.left === nextLeft && prev.width === nextWidth) {
        return prev;
      }
      return { left: nextLeft, width: nextWidth, visible: true };
    });
  }, [selectedIndex]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [updateIndicator]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      updateIndicator();
    });
    if (navListRef.current) {
      observer.observe(navListRef.current);
    }
    tabRefs.current.forEach((el) => {
      if (el) {
        observer.observe(el);
      }
    });
    return () => observer.disconnect();
  }, [updateIndicator]);

  const handleTabChange = (index: number) => {
    const target = navList[index];
    if (!target) return;
    if (target.key === "search") {
      onOpenSearch?.();
      return;
    }
    setActiveTab(target.key as "home" | "instances" | "discovery" | "settings");
  };

  const unselectedColor = isDark ? "rgba(255,255,255,0.6)" : "gray";
  const selectedColor = isDark ? "rgb(199,210,254)" : "rgb(67,56,202)";

  return (
    <AdvancedCard
      level="back"
      className={clsx(
        "pl-6 pr-2 py-2",
        animationStyles.animatedCard,
        isAnimating ? animationStyles.animate : ""
      )}
    >
      <div className="flex items-center h-8">
        <span
          className={clsx(
            "font-bold text-base mr-5 tracking-wider cursor-pointer select-none",
            isDark ? "text-blue-400" : "text-indigo-600"
          )}
          onClick={() => setActiveTab("home")}
        >
          AsumiGal
        </span>

        <div
          ref={navListRef}
          role="tablist"
          className={styles.tabList}
          style={
            {
              "--head-nav-indicator-bg": indicatorBg,
              "--head-nav-indicator-border": indicatorBorder,
              "--head-nav-hover-bg": hoverBg,
            } as CSSProperties
          }
        >
          <div
            className={`${styles.indicator} ${
              indicator.visible ? styles.indicatorVisible : ""
            }`}
            style={{
              transform: `translateX(${indicator.left}px)`,
              width: `${indicator.width}px`,
            }}
          />
          {navList.map((item, index) => {
            const isSelected = selectedIndex === index;
            return (
              <button
                key={`${item.label}-${item.key}`}
                ref={(el: HTMLButtonElement | null) => {
                  tabRefs.current[index] = el;
                }}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => handleTabChange(index)}
                className={styles.tabButton}
                style={{
                  fontWeight: isSelected ? 600 : "normal",
                  color: isSelected ? selectedColor : unselectedColor,
                }}
              >
                <span className={styles.tabContent}>
                  <item.icon
                    size={14}
                    className={styles.tabIcon}
                  />
                  <span className="text-sm leading-none">{item.label}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div
          className={clsx(
            "w-px h-4 mx-3",
            isDark ? "bg-white/20" : "bg-black/10"
          )}
        />

        <button
          onClick={onRefresh}
          className={clsx(
            "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
            isDark
              ? "text-white/60 hover:text-white hover:bg-white/10"
              : "text-gray-500 hover:text-black hover:bg-black/5"
          )}
          aria-label="刷新"
        >
          <RefreshCw size={15} />
        </button>
      </div>
    </AdvancedCard>
  );
};

export default HeadNavBar;
