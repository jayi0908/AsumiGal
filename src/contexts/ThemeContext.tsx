import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

export interface AppConfig {
  // --- 外观 ---
  theme: ThemeMode;
  fontFamily: string;
  fontSize: number;
  customBgImage: string;
  useInstanceBg: boolean;
  
  // --- 全局游戏设置 ---
  crossoverPath: string; // CrossOver.app 路径
  bottlesPath: string;   // 容器库路径
  enableDiscovery: boolean; // 搜索/发现功能开关
  defaultBottle: string;
  pdPath: string; // PD 虚拟机本地路径
  defaultPdVm: string;  // 默认虚拟机 Applications 目录名称
   defaultDiskGameRoot: string; // 默认硬盘游戏根目录
   defaultLocalGameRoot: string; // 默认本机游戏根目录
   screenshotShortcut: string; // 全局截屏快捷键（Tauri 加速器格式，如 cmd+alt+s）
}

const DEFAULT_CONFIG: AppConfig = {
  theme: "dark",
  fontFamily: "system-ui", // 默认系统字体
  fontSize: 1.0,
  customBgImage: "",
  useInstanceBg: true,
  crossoverPath: "/Applications/CrossOver.app",
  bottlesPath: "~/Library/Application Support/CrossOver/Bottles",
  enableDiscovery: true,
  defaultBottle: "Default",
  pdPath: "~/Applications (Parallels)",
  defaultPdVm: "",
  defaultDiskGameRoot: "",
  defaultLocalGameRoot: "",
  screenshotShortcut: "cmd+alt+s",
};

interface ThemeContextType {
  config: AppConfig;
  updateConfig: (newConfig: Partial<AppConfig>) => void;
  currentTheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("dark");

  // 1. 初始化读取
  useEffect(() => {
    const saved = localStorage.getItem("app_config");
    if (saved) {
      try {
        setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(saved) });
      } catch (e) {
        console.error("配置读取失败", e);
      }
    }

    // 监听系统主题变化
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemTheme(mediaQuery.matches ? "dark" : "light");
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // 2. 计算当前实际主题
  const currentTheme = config.theme === "system" ? systemTheme : config.theme;

  // 3. 应用全局副作用 (字体大小 & 主题 Class)
  useEffect(() => {
    localStorage.setItem("app_config", JSON.stringify(config));

    // 1. 应用字体大小
    document.documentElement.style.fontSize = `${config.fontSize * 16}px`;
    
    // 2. 应用字体族 (通过 CSS 变量)
    const fontVal = config.fontFamily === "system-ui" 
      ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
      : `"${config.fontFamily}", sans-serif`;
    
    // 设置 CSS 变量，配合 index.css 里的 * { ... } 即可全局生效
    document.documentElement.style.setProperty('--app-font-family', fontVal);

    // 3. 应用 Tailwind Dark Mode 类
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(currentTheme);
    
  }, [config, currentTheme]);

  const updateConfig = (newConfig: Partial<AppConfig>) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
  };

  return (
    <ThemeContext.Provider value={{ config, updateConfig, currentTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
