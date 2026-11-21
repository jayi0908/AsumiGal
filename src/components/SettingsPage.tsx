import { useState, useEffect } from "react";
import {
  useTheme,
  ThemeMode,
  LauncherActionOnLaunch,
  DefaultViewMode,
  DefaultSortMode,
} from "../contexts/ThemeContext";
import {
  Monitor,
  Sun,
  Moon,
  Type,
  Image as ImageIcon,
  FolderOpen,
  Layout,
  Cog,
  Info,
  Github,
  Sliders,
  Search,
  Camera,
  Globe,
  Terminal,
  Sparkles,
  RotateCcw,
  AppWindow,
  ChevronDown,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { convertFileSrc } from "@tauri-apps/api/core";
import { unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { SidebarNavItem } from "./SidebarNavItem";
import { useToast } from "./ToastProvider";
import { BackendService } from "../services/backend";
import { clsx } from "clsx";

const DEFAULT_SCREENSHOT_SHORTCUT = "cmd+alt+s";

function buildAccelerator(e: KeyboardEvent): string | null {
  const keyMap: Record<string, string> = {
    " ": "space",
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Enter: "enter",
    Tab: "tab",
    Backspace: "backspace",
    Delete: "delete",
    Insert: "insert",
    Home: "home",
    End: "end",
    PageUp: "pageup",
    PageDown: "pagedown",
    Semicolon: "semicolon",
    Comma: "comma",
    Period: "period",
    Slash: "slash",
    Backslash: "backslash",
    Quote: "quote",
    BracketLeft: "bracketleft",
    BracketRight: "bracketright",
    Minus: "minus",
    Equal: "equal",
    Backquote: "backquote",
  };
  const key = e.key;
  let keyPart = "";
  if (/^[a-zA-Z]$/.test(key)) keyPart = key.toLowerCase();
  else if (/^\d$/.test(key)) keyPart = key;
  else if (/^f(\d{1,2})$/i.test(key)) keyPart = key.toLowerCase();
  else keyPart = keyMap[key] ?? "";
  if (!keyPart) return null;

  const mods: string[] = [];
  if (e.metaKey) mods.push("cmd");
  if (e.ctrlKey) mods.push("ctrl");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey) mods.push("shift");
  if (mods.length === 0) return null;
  return [...mods, keyPart].join("+");
}

function formatAccelerator(acc: string): string {
  const modGlyphs: Record<string, string> = {
    cmd: "⌘",
    ctrl: "⌃",
    alt: "⌥",
    shift: "⇧",
  };
  const keyGlyphs: Record<string, string> = {
    space: "Space",
    up: "↑",
    down: "↓",
    left: "←",
    right: "→",
    enter: "↩",
    tab: "⇥",
    backspace: "⌫",
    delete: "⌦",
    insert: "Ins",
    home: "↖",
    end: "↘",
    pageup: "PgUp",
    pagedown: "PgDn",
  };
  return (acc || "")
    .split("+")
    .map(
      (p) =>
        modGlyphs[p] ??
        keyGlyphs[p] ??
        (p.length === 1
          ? p.toUpperCase()
          : p.charAt(0).toUpperCase() + p.slice(1))
    )
    .join("");
}

type SettingTab = "general" | "global" | "appearance" | "about";

export function SettingsPage() {
  const { config, updateConfig, resetConfig, currentTheme } = useTheme();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingTab>("general");
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [bottles, setBottles] = useState<string[]>([]);
  const [pdVms, setPdVms] = useState<string[]>([]);
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);

  useEffect(() => {
    if (!isRecordingShortcut) return;
    unregisterAll().catch(() => {});
    const MOD_KEYS = new Set(["Meta", "Control", "Alt", "Shift"]);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsRecordingShortcut(false);
        return;
      }
      if (MOD_KEYS.has(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const acc = buildAccelerator(e);
      if (!acc) {
        showToast("请至少包含一个修饰键（Cmd / Ctrl / Alt / Shift）", "error");
        return;
      }
      setIsRecordingShortcut(false);
      updateConfig({ screenshotShortcut: acc });
      showToast("快捷键已更新", "success");
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.dispatchEvent(new CustomEvent("asumigal-shortcut-reregister"));
    };
  }, [isRecordingShortcut, updateConfig, showToast]);

  useEffect(() => {
    const loadFonts = async () => {
      try {
        const fonts = await BackendService.getSystemFonts();
        setSystemFonts(["system-ui", ...fonts]);
      } catch (e) {
        console.error("字体加载失败", e);
        setSystemFonts(["system-ui", "Arial", "PingFang SC"]);
      }
    };
    loadFonts();
  }, []);

  useEffect(() => {
    const loadContainers = async () => {
      try {
        const resBottles = await BackendService.getCrossoverBottles(
          config.bottlesPath
        );
        const validBottles = resBottles.length > 0 ? resBottles : ["Default"];
        setBottles(validBottles);
        if (!validBottles.includes(config.defaultBottle)) {
          updateConfig({ defaultBottle: validBottles[0] });
        }
      } catch {
        setBottles(["Default"]);
      }

      try {
        const resVms = await BackendService.getPdVms(config.pdPath);
        setPdVms(resVms.length > 0 ? resVms : [""]);
      } catch {
        setPdVms([""]);
      }
    };
    loadContainers();
  }, [config.bottlesPath, config.pdPath]);

  const getHomePath = async () => {
    try {
      return await BackendService.getHomeDir();
    } catch {
      return undefined;
    }
  };

  const handleSelectBg = async () => {
    try {
      const home = await getHomePath();
      const selected = await open({
        multiple: false,
        directory: false,
        defaultPath: home,
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (selected && typeof selected === "string")
        updateConfig({ customBgImage: convertFileSrc(selected) });
    } catch (e) {
      console.error(e);
    }
  };

  const getBgSrc = (src: string) => {
    if (!src) return "";
    if (
      src.startsWith("http") ||
      src.startsWith("asset://") ||
      src.startsWith("data:")
    )
      return src;
    return convertFileSrc(src);
  };

  const handleSelectFolder = async (
    key:
      | "crossoverPath"
      | "bottlesPath"
      | "pdPath"
      | "defaultDiskGameRoot"
      | "defaultLocalGameRoot"
  ) => {
    try {
      const home = await getHomePath();
      const defaultPath = key === "crossoverPath" ? "/Applications" : home;
      const selected = await open({
        multiple: false,
        directory: true,
        defaultPath: defaultPath,
      });
      if (selected) updateConfig({ [key]: selected as string });
    } catch (e) {
      console.error(e);
    }
  };

  const isDark = currentTheme === "dark";
  const cardClass = clsx(
    "border rounded-xl p-5 space-y-4 transition-all shadow-sm",
    isDark
      ? "bg-[#1b1e28]/85 border-white/[0.08]"
      : "bg-white/85 border-slate-300/70"
  );
  const headingClass = clsx(
    "text-xl font-bold tracking-tight",
    isDark ? "text-slate-100" : "text-slate-900"
  );
  const subHeadingClass = clsx(
    "font-semibold text-sm flex items-center gap-2",
    isDark ? "text-slate-200" : "text-slate-900"
  );
  const inputBaseClass = clsx(
    "rounded-lg px-3 py-2 text-xs outline-none transition-colors border appearance-none",
    isDark
      ? "bg-black/30 border-white/10 text-slate-100 focus:border-indigo-500 placeholder:text-slate-500"
      : "bg-white border-slate-300 text-slate-900 focus:border-indigo-500 placeholder:text-slate-400"
  );
  const inputFullClass = clsx("w-full", inputBaseClass);
  const labelClass = clsx(
    "text-[13px] font-medium",
    isDark ? "text-slate-200" : "text-slate-800"
  );
  const descClass = clsx(
    "text-xs leading-relaxed mt-0.5",
    isDark ? "text-slate-400" : "text-slate-600"
  );

  const SwitchToggle = ({
    checked,
    onChange,
  }: {
    checked: boolean;
    onChange: () => void;
  }) => (
    <button
      type="button"
      onClick={onChange}
      className={clsx(
        "w-10 h-5 rounded-full transition-colors relative shrink-0",
        checked
          ? "bg-indigo-600"
          : isDark
            ? "bg-white/15"
            : "bg-slate-300"
      )}
    >
      <div
        className={clsx(
          "w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-all shadow-sm",
          checked ? "left-[22px]" : "left-[3px]"
        )}
      />
    </button>
  );

  const SelectChevron = () => (
    <ChevronDown
      size={14}
      className={clsx(
        "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2",
        isDark ? "text-slate-400" : "text-slate-500"
      )}
    />
  );

  return (
    <div className="h-full flex relative">
      {/* ===== 左侧导航 ===== */}
      <aside className="w-1/4 min-w-[200px] max-w-[280px] flex flex-col shrink-0 border-r border-slate-300/60 dark:border-white/[0.08] bg-slate-500/[0.03] dark:bg-black/10 rounded-l-2xl overflow-hidden my-3 ml-3">
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2.5 space-y-1">
          <SidebarNavItem
            active={activeTab === "general"}
            icon={<Sliders size={17} className="text-indigo-500 shrink-0" />}
            label="通用"
            onClick={() => setActiveTab("general")}
          />
          <SidebarNavItem
            active={activeTab === "global"}
            icon={<Cog size={17} className="text-indigo-500 shrink-0" />}
            label="全局游戏设置"
            onClick={() => setActiveTab("global")}
          />
          <SidebarNavItem
            active={activeTab === "appearance"}
            icon={<Layout size={17} className="text-indigo-500 shrink-0" />}
            label="外观"
            onClick={() => setActiveTab("appearance")}
          />
          <SidebarNavItem
            active={activeTab === "about"}
            icon={<Info size={17} className="text-indigo-500 shrink-0" />}
            label="关于"
            onClick={() => setActiveTab("about")}
          />
        </div>
      </aside>

      {/* ===== 右侧内容 ===== */}
      <main className="flex-1 h-full min-w-0 relative flex flex-col">
        <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-7">
          {/* 1. 通用 */}
          {activeTab === "general" && (
            <div className="space-y-5 max-w-3xl">
              <h1 className={headingClass}>通用</h1>

              {/* 常规行为 */}
              <div className={cardClass}>
                <h3 className={subHeadingClass}>
                  <AppWindow size={16} className="text-indigo-500" /> 窗口与列表
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-6">
                    <div className="flex-1 min-w-0">
                      <div className={labelClass}>启动器可见性</div>
                      <div className={descClass}>
                        启动游戏后，控制主窗口的显示状态
                      </div>
                    </div>
                    <div className="relative w-40 shrink-0">
                      <select
                        value={config.onGameLaunchAction || "keep"}
                        onChange={(e) =>
                          updateConfig({
                            onGameLaunchAction: e.target
                              .value as LauncherActionOnLaunch,
                          })
                        }
                        className={clsx(inputBaseClass, "w-full pr-8")}
                      >
                        <option value="keep">保持显示</option>
                        <option value="minimize">最小化</option>
                        <option value="hide">隐藏到后台</option>
                      </select>
                      <SelectChevron />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-200/80 dark:border-white/5">
                    <div className="space-y-1.5">
                      <span className={labelClass}>实例默认视图</span>
                      <div className="relative">
                        <select
                          value={config.defaultViewMode || "list"}
                          onChange={(e) =>
                            updateConfig({
                              defaultViewMode: e.target.value as DefaultViewMode,
                            })
                          }
                          className={clsx(inputFullClass, "pr-8")}
                        >
                          <option value="list">列表视图</option>
                          <option value="grid">网格视图</option>
                        </select>
                        <SelectChevron />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <span className={labelClass}>实例默认排序</span>
                      <div className="relative">
                        <select
                          value={config.defaultSortMode || "recent"}
                          onChange={(e) =>
                            updateConfig({
                              defaultSortMode: e.target.value as DefaultSortMode,
                            })
                          }
                          className={clsx(inputFullClass, "pr-8")}
                        >
                          <option value="recent">最近运行</option>
                          <option value="name">实例名称</option>
                        </select>
                        <SelectChevron />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 搜索/发现 */}
              <div className={cardClass}>
                <h3 className={subHeadingClass}>
                  <Search size={16} className="text-indigo-500" /> 发现与搜索
                </h3>
                <div className="flex items-center justify-between gap-6">
                  <div className="flex-1 min-w-0">
                    <div className={labelClass}>
                      {config.enableDiscovery
                        ? "导航栏显示「发现」页"
                        : "导航栏显示「搜索」框"}
                    </div>
                    <div className={descClass}>
                      在任意界面均可通过 ⌘S 唤起搜索弹窗
                    </div>
                  </div>
                  <SwitchToggle
                    checked={config.enableDiscovery}
                    onChange={() =>
                      updateConfig({ enableDiscovery: !config.enableDiscovery })
                    }
                  />
                </div>
              </div>

              {/* 截图 */}
              <div className={cardClass}>
                <h3 className={subHeadingClass}>
                  <Camera size={16} className="text-indigo-500" /> 截图
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-6">
                    <div className="flex-1 min-w-0">
                      <div className={labelClass}>
                        全局截屏快捷键：
                        <span className="font-mono text-indigo-600 dark:text-indigo-400 ml-1">
                          {formatAccelerator(
                            config.screenshotShortcut ||
                              DEFAULT_SCREENSHOT_SHORTCUT
                          )}
                        </span>
                      </div>
                      <div className={descClass}>
                        游戏运行时按快捷键截取窗口，保存到实例目录下的{" "}
                        <span className="font-mono">screen_shots</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isRecordingShortcut ? (
                        <button
                          className="px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/40 animate-pulse text-xs font-medium"
                          onClick={() => setIsRecordingShortcut(false)}
                        >
                          按下快捷键… (Esc 取消)
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => setIsRecordingShortcut(true)}
                            className="px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-xs font-medium transition-colors"
                          >
                            重新绑定
                          </button>
                          {(config.screenshotShortcut ||
                            DEFAULT_SCREENSHOT_SHORTCUT) !==
                            DEFAULT_SCREENSHOT_SHORTCUT && (
                            <button
                              onClick={() =>
                                updateConfig({
                                  screenshotShortcut:
                                    DEFAULT_SCREENSHOT_SHORTCUT,
                                })
                              }
                              className="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-500/10 transition-colors"
                            >
                              恢复默认
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-6 pt-3 border-t border-slate-200/80 dark:border-white/5">
                    <div className={clsx(descClass, "flex-1 min-w-0 mt-0")}>
                      截图需要系统「屏幕录制」权限。若应用更新后失效，请重新勾选授权。
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          await BackendService.openScreenRecordingSettings();
                        } catch (e) {
                          showToast(`${e}`, "error");
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-500/10 hover:bg-slate-500/20 text-xs font-medium transition-colors shrink-0"
                    >
                      打开系统设置
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 2. 全局游戏设置 */}
          {activeTab === "global" && (
            <div className="space-y-5 max-w-3xl">
              <h1 className={headingClass}>全局游戏设置</h1>

              {/* 区域语言与日志 */}
              <div className={cardClass}>
                <h3 className={subHeadingClass}>
                  <Globe size={16} className="text-indigo-500" /> 语言与日志
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-6">
                    <div className="flex-1 min-w-0">
                      <div className={labelClass}>默认区域语言 (LC_ALL)</div>
                      <div className={descClass}>
                        未单独配置的 CrossOver 实例将使用此语言环境启动
                      </div>
                    </div>
                    <div className="relative w-48 shrink-0">
                      <select
                        value={config.defaultLocale || "zh_CN.UTF-8"}
                        onChange={(e) =>
                          updateConfig({ defaultLocale: e.target.value })
                        }
                        className={clsx(inputBaseClass, "w-full pr-8")}
                      >
                        <option value="zh_CN.UTF-8">简体中文 (zh_CN)</option>
                        <option value="ja_JP.UTF-8">日本語 (ja_JP)</option>
                        <option value="zh_TW.UTF-8">繁體中文 (zh_TW)</option>
                        <option value="en_US.UTF-8">English (en_US)</option>
                      </select>
                      <SelectChevron />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-6 pt-3 border-t border-slate-200/80 dark:border-white/5">
                    <div className="flex-1 min-w-0">
                      <div className={labelClass}>异常退出时打开日志</div>
                      <div className={descClass}>
                        游戏在启动后 6 秒内退出时，自动切换到该实例的日志页
                      </div>
                    </div>
                    <SwitchToggle
                      checked={config.autoPopupCrashLog ?? true}
                      onChange={() =>
                        updateConfig({
                          autoPopupCrashLog: !(config.autoPopupCrashLog ?? true),
                        })
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between gap-6 pt-3 border-t border-slate-200/80 dark:border-white/5">
                    <div className="flex-1 min-w-0">
                      <div className={labelClass}>
                        Wine 调试日志 (+err,+warn)
                      </div>
                      <div className={descClass}>
                        默认关闭 (-all)；排查黑屏或崩溃问题时可临时开启
                      </div>
                    </div>
                    <SwitchToggle
                      checked={!!config.enableWineDebugLog}
                      onChange={() =>
                        updateConfig({
                          enableWineDebugLog: !config.enableWineDebugLog,
                        })
                      }
                    />
                  </div>
                </div>
              </div>

              {/* 默认容器 */}
              <div className={cardClass}>
                <h2 className={subHeadingClass}>
                  <Terminal size={16} className="text-indigo-500" /> 默认容器
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <span className={labelClass}>CrossOver 默认容器</span>
                    <div className="relative">
                      <select
                        value={
                          bottles.includes(config.defaultBottle || "Default")
                            ? config.defaultBottle || "Default"
                            : bottles[0] || "Default"
                        }
                        onChange={(e) =>
                          updateConfig({ defaultBottle: e.target.value })
                        }
                        className={clsx(inputFullClass, "pr-8")}
                      >
                        {config.defaultBottle &&
                          !bottles.includes(config.defaultBottle) && (
                            <option value={config.defaultBottle}>
                              {config.defaultBottle} (当前)
                            </option>
                          )}
                        {bottles.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                      <SelectChevron />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className={labelClass}>Parallels 默认虚拟机</span>
                    <div className="relative">
                      <select
                        value={
                          pdVms.includes(config.defaultPdVm || "")
                            ? config.defaultPdVm || ""
                            : pdVms[0] || ""
                        }
                        onChange={(e) =>
                          updateConfig({ defaultPdVm: e.target.value })
                        }
                        className={clsx(inputFullClass, "pr-8")}
                      >
                        {config.defaultPdVm &&
                          !pdVms.includes(config.defaultPdVm) && (
                            <option value={config.defaultPdVm}>
                              {config.defaultPdVm} (当前)
                            </option>
                          )}
                        {pdVms.map((vm) => (
                          <option key={vm} value={vm}>
                            {vm || "未检测到虚拟机"}
                          </option>
                        ))}
                      </select>
                      <SelectChevron />
                    </div>
                  </div>
                </div>
              </div>

              {/* 路径配置 */}
              <div className={cardClass}>
                <h3 className={subHeadingClass}>
                  <FolderOpen size={16} className="text-indigo-500" /> 路径
                </h3>
                <div className="space-y-3.5">
                  <div className="space-y-1">
                    <label className={labelClass}>CrossOver 路径</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={config.crossoverPath}
                        onChange={(e) =>
                          updateConfig({ crossoverPath: e.target.value })
                        }
                        className={inputFullClass}
                      />
                      <button
                        onClick={() => handleSelectFolder("crossoverPath")}
                        className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 shrink-0"
                      >
                        <FolderOpen size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className={labelClass}>容器库路径 (Bottles)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={config.bottlesPath}
                        onChange={(e) =>
                          updateConfig({ bottlesPath: e.target.value })
                        }
                        className={inputFullClass}
                      />
                      <button
                        onClick={() => handleSelectFolder("bottlesPath")}
                        className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 shrink-0"
                      >
                        <FolderOpen size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className={labelClass}>Parallels 应用路径</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={config.pdPath}
                        onChange={(e) => updateConfig({ pdPath: e.target.value })}
                        className={inputFullClass}
                      />
                      <button
                        onClick={() => handleSelectFolder("pdPath")}
                        className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 shrink-0"
                      >
                        <FolderOpen size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1">
                      <label className={labelClass}>外置硬盘游戏根目录</label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={config.defaultDiskGameRoot}
                          onChange={(e) =>
                            updateConfig({ defaultDiskGameRoot: e.target.value })
                          }
                          placeholder="/Volumes/..."
                          className={inputFullClass}
                        />
                        <button
                          onClick={() =>
                            handleSelectFolder("defaultDiskGameRoot")
                          }
                          className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 shrink-0"
                        >
                          <FolderOpen size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className={labelClass}>本机游戏根目录</label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={config.defaultLocalGameRoot}
                          onChange={(e) =>
                            updateConfig({
                              defaultLocalGameRoot: e.target.value,
                            })
                          }
                          placeholder="~/Games"
                          className={inputFullClass}
                        />
                        <button
                          onClick={() =>
                            handleSelectFolder("defaultLocalGameRoot")
                          }
                          className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 shrink-0"
                        >
                          <FolderOpen size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. 外观 */}
          {activeTab === "appearance" && (
            <div className="space-y-5 max-w-3xl">
              <div className="flex items-center justify-between">
                <h1 className={headingClass}>外观</h1>
                <button
                  onClick={() => {
                    resetConfig();
                    showToast("已恢复默认设置", "info");
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-500/10 transition-colors"
                >
                  <RotateCcw size={13} /> 恢复默认
                </button>
              </div>

              {/* 颜色模式 */}
              <div className={cardClass}>
                <h2 className={subHeadingClass}>
                  <Monitor size={16} className="text-indigo-500" /> 颜色模式
                </h2>
                <div
                  className={clsx(
                    "rounded-xl p-1 flex border",
                    isDark
                      ? "bg-black/25 border-white/5"
                      : "bg-slate-200/70 border-slate-300/60"
                  )}
                >
                  {(["system", "light", "dark"] as ThemeMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => updateConfig({ theme: mode })}
                      className={clsx(
                        "flex-1 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2",
                        config.theme === mode
                          ? "bg-indigo-600 text-white shadow-sm"
                          : isDark
                            ? "text-slate-400 hover:text-white"
                            : "text-slate-700 hover:text-slate-900"
                      )}
                    >
                      {mode === "system" && <Monitor size={14} />}
                      {mode === "light" && <Sun size={14} />}
                      {mode === "dark" && <Moon size={14} />}
                      {mode === "system"
                        ? "跟随系统"
                        : mode === "light"
                          ? "浅色"
                          : "深色"}
                    </button>
                  ))}
                </div>
              </div>

              {/* 背景图像 */}
              <div className={cardClass}>
                <h2 className={subHeadingClass}>
                  <ImageIcon size={16} className="text-indigo-500" /> 背景
                </h2>

                <div className="flex items-center justify-between gap-6">
                  <div className="flex-1 min-w-0">
                    <div className={labelClass}>使用实例封面作为背景</div>
                    <div className={descClass}>
                      切换当前实例时同步更换背景图
                    </div>
                  </div>
                  <SwitchToggle
                    checked={config.useInstanceBg}
                    onChange={() =>
                      updateConfig({ useInstanceBg: !config.useInstanceBg })
                    }
                  />
                </div>

                <div className="grid grid-cols-2 gap-5 pt-3 border-t border-slate-200/80 dark:border-white/5">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className={labelClass}>背景模糊</span>
                      <span className="font-mono text-slate-500 dark:text-slate-400">
                        {config.bgBlur ?? 4}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="16"
                      step="1"
                      value={config.bgBlur ?? 4}
                      onChange={(e) =>
                        updateConfig({ bgBlur: parseInt(e.target.value, 10) })
                      }
                      className="w-full accent-indigo-500 h-1 bg-slate-400/35 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className={labelClass}>背景遮罩</span>
                      <span className="font-mono text-slate-500 dark:text-slate-400">
                        {Math.round((config.bgOverlayOpacity ?? 0.45) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.15"
                      max="0.85"
                      step="0.05"
                      value={config.bgOverlayOpacity ?? 0.45}
                      onChange={(e) =>
                        updateConfig({
                          bgOverlayOpacity: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-indigo-500 h-1 bg-slate-400/35 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 pt-2">
                  <span className={labelClass}>自定义图像</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={config.customBgImage || ""}
                      onChange={(e) =>
                        updateConfig({ customBgImage: e.target.value })
                      }
                      placeholder="图片 URL 或本地路径"
                      className={inputFullClass}
                    />
                    <button
                      onClick={handleSelectBg}
                      className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 shrink-0"
                    >
                      <FolderOpen size={16} />
                    </button>
                  </div>
                  {config.customBgImage && (
                    <div className="mt-2 h-28 w-full rounded-lg overflow-hidden border border-slate-300/70 dark:border-white/10 relative group bg-black/40">
                      <img
                        src={getBgSrc(config.customBgImage)}
                        className="w-full h-full object-cover"
                        alt="custom-bg"
                      />
                      <button
                        onClick={() => updateConfig({ customBgImage: "" })}
                        className="absolute top-2 right-2 bg-black/60 hover:bg-rose-500 py-1 px-2.5 rounded-md text-white text-xs opacity-0 group-hover:opacity-100 transition-all backdrop-blur"
                      >
                        清除
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 字体与首页文案 */}
              <div className={cardClass}>
                <h2 className={subHeadingClass}>
                  <Sparkles size={16} className="text-indigo-500" /> 字体与首页
                </h2>

                <div className="flex items-center justify-between gap-6">
                  <div className="flex-1 min-w-0">
                    <div className={labelClass}>显示首页问候语</div>
                    <div className={descClass}>
                      关闭后首页仅保留背景图与启动控制栏
                    </div>
                  </div>
                  <SwitchToggle
                    checked={config.showHomeGreeting ?? true}
                    onChange={() =>
                      updateConfig({
                        showHomeGreeting: !(config.showHomeGreeting ?? true),
                      })
                    }
                  />
                </div>

                {(config.showHomeGreeting ?? true) && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1">
                      <span className={labelClass}>主标题</span>
                      <input
                        type="text"
                        value={config.greetingTitle ?? "Ciallo~ (∠・ω< )⌒★"}
                        onChange={(e) =>
                          updateConfig({ greetingTitle: e.target.value })
                        }
                        className={inputFullClass}
                      />
                    </div>
                    <div className="space-y-1">
                      <span className={labelClass}>副标题</span>
                      <input
                        type="text"
                        value={config.greetingSubtitle ?? "欢迎回来，先輩"}
                        onChange={(e) =>
                          updateConfig({ greetingSubtitle: e.target.value })
                        }
                        className={inputFullClass}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-200/80 dark:border-white/5">
                  <div className="space-y-1.5">
                    <span className={labelClass}>界面字体</span>
                    <div className="relative">
                      <select
                        value={config.fontFamily}
                        onChange={(e) =>
                          updateConfig({ fontFamily: e.target.value })
                        }
                        className={clsx(inputFullClass, "pr-8")}
                      >
                        {systemFonts.map((f) => (
                          <option
                            key={f}
                            value={f === "system-ui" ? "system-ui" : f}
                          >
                            {f === "system-ui" ? "默认" : f}
                          </option>
                        ))}
                      </select>
                      <SelectChevron />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className={labelClass}>
                        <Type size={12} className="inline mr-1" />
                        字体大小
                      </span>
                      <span className="font-mono text-slate-500 dark:text-slate-400">
                        {Math.round(config.fontSize * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.85"
                      max="1.15"
                      step="0.05"
                      value={config.fontSize}
                      onChange={(e) =>
                        updateConfig({ fontSize: parseFloat(e.target.value) })
                      }
                      className="w-full accent-indigo-500 h-1 bg-slate-400/35 rounded-lg appearance-none cursor-pointer mt-2"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. 关于 */}
          {activeTab === "about" && (
            <div className="space-y-5 max-w-3xl">
              <h1 className={headingClass}>关于</h1>

              <div className={cardClass}>
                <div className="flex items-start gap-5">
                  <img
                    src="/app-icon.png"
                    alt="AsumiGal Logo"
                    className="w-16 h-16 rounded-2xl shadow-md object-cover"
                  />

                  <div className="flex-1 space-y-2">
                    <div className="flex items-baseline gap-2.5">
                      <h2 className="text-2xl font-bold tracking-tight">
                        AsumiGal
                      </h2>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-mono font-medium">
                        v0.5.0
                      </span>
                    </div>

                    <p className={descClass}>
                      专为 macOS 设计的 Galgame / 视觉小说管理器，支持 CrossOver、Parallels Desktop 与原生应用。
                    </p>

                    <div className="pt-2 flex gap-2.5">
                      <button
                        onClick={async () => {
                          await openUrl("https://github.com/jayi0908/AsumiGal");
                        }}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-slate-500/10 hover:bg-slate-500/20 transition-all"
                      >
                        <Github size={15} />
                        在 GitHub 查看源代码
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className={cardClass}>
                <h3 className={subHeadingClass}>致谢</h3>
                <ul className={clsx("space-y-1.5", descClass)}>
                  <li>• SJMCL — 部分前端布局与液态玻璃效果参考自此开源项目</li>
                  <li>• TouchGal & VNDB — 提供游戏元数据检索支持</li>
                  <li>• Tauri & React — 桌面应用框架与前端组件库</li>
                </ul>
              </div>

              <div className={cardClass}>
                <h3 className={subHeadingClass}>开源协议</h3>
                <p className={descClass}>
                  本项目遵循{" "}
                  <a
                    href="https://www.gnu.org/licenses/gpl-3.0.html"
                    className="text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    GNU General Public License v3.0
                  </a>{" "}
                  协议开源。
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
