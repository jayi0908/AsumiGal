import { useState, useEffect, useRef, useMemo } from "react";
import {
  Terminal,
  Trash2,
  Copy,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Wrench,
  Bug,
  Filter,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { BackendService } from "../services/backend";
import { GameInstance, GameLogLine } from "../types/instance";
import { useToast } from "./ToastProvider";
import clsx from "clsx";

interface GameLogPanelProps {
  instanceId: string;
  formData: Partial<GameInstance>;
  onUpdateFormData: (updates: Partial<GameInstance>) => void;
}

interface DiagnosticHint {
  id: string;
  title: string;
  severity: "error" | "warn" | "info";
  description: string;
  actionLabel?: string;
  onApply?: () => void;
}

export function GameLogPanel({
  instanceId,
  formData,
  onUpdateFormData,
}: GameLogPanelProps) {
  const { showToast } = useToast();
  const [logs, setLogs] = useState<GameLogLine[]>([]);
  const [filterLevel, setFilterLevel] = useState<"all" | "error" | "warn">("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    BackendService.getInstanceLogs(instanceId)
      .then((list) => {
        if (active) setLogs(list || []);
      })
      .catch(() => {});

    const unlistenPromise = listen<GameLogLine>("game-log-line", (event) => {
      if (event.payload.instanceId === instanceId) {
        setLogs((prev) => [...prev.slice(-799), event.payload]);
      }
    });

    return () => {
      active = false;
      unlistenPromise.then((fn) => fn());
    };
  }, [instanceId]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll, filterLevel]);

  const filteredLogs = useMemo(() => {
    if (filterLevel === "all") return logs;
    if (filterLevel === "error") {
      return logs.filter((l) => l.level === "error" || l.level === "system");
    }
    return logs.filter((l) => l.level === "error" || l.level === "warn" || l.level === "system");
  }, [logs, filterLevel]);

  const appendEnvVar = (kv: string) => {
    const cur = (formData.envVars || "").trim();
    const key = kv.split("=")[0];
    if (cur.includes(key)) {
      showToast(`环境变量已包含 ${key}`, "info");
      return;
    }
    const next = cur ? `${cur} ${kv}` : kv;
    onUpdateFormData({ envVars: next });
    showToast(`已应用环境变量：${kv}`, "success");
  };

  // 智能排错诊断引擎：分析当前日志内容 + 实例配置，给出针对 Galgame 在 macOS 下常见问题的修复建议
  const diagnostics = useMemo<DiagnosticHint[]>(() => {
    const hints: DiagnosticHint[] = [];
    const allText = logs.map((l) => l.line.toLowerCase()).join("\n");

    if (
      allText.includes("quartz") ||
      allText.includes("mfplat") ||
      allText.includes("gstreamer") ||
      allText.includes("wmvcore") ||
      allText.includes("devenum")
    ) {
      hints.push({
        id: "video-codec",
        title: "检测到 OP/过场动画解码器报错 (DirectShow / MediaFoundation)",
        severity: "error",
        description:
          "许多 Galgame 播放片头 OP 视频时会在 Wine 下黑屏或崩溃。建议禁用内置 quartz/wmp 解码或通过环境变量跳过异常媒体组件。",
        actionLabel: "一键注入跳过视频解码环境变量",
        onApply: () => appendEnvVar("WINEDLLOVERRIDES=quartz,wmp,mfplat=d"),
      });
    }

    if (
      allText.includes("d3d") ||
      allText.includes("dxgi") ||
      allText.includes("vulkan") ||
      allText.includes("moltenvk") ||
      allText.includes("wined3d")
    ) {
      hints.push({
        id: "graphics-backend",
        title: "检测到 DirectX / 图形渲染层告警",
        severity: "warn",
        description:
          "若遇到窗口黑屏、闪烁或画面撕裂，可在 CrossOver 容器右侧开启「D3DMetal」或「DXVK」，或切换 WineD3D 渲染后端。",
      });
    }

    if (
      allText.includes("c0000135") ||
      allText.includes("module not found") ||
      allText.includes("msvcp") ||
      allText.includes("vcruntime") ||
      allText.includes("mfc1")
    ) {
      hints.push({
        id: "missing-dll",
        title: "缺少 Windows 运行库 (VC++ Redist / DLL 缺失)",
        severity: "error",
        description:
          "日志显示游戏启动时未能加载必要的动态链接库。请在 CrossOver 对应容器中安装「Microsoft Visual C++ 2015-2022 (x86/x64)」组件。",
      });
    }

    if (
      allText.includes("font") ||
      allText.includes("freetype") ||
      allText.includes("gdi32")
    ) {
      hints.push({
        id: "font-garbled",
        title: "字体渲染或字符集提示",
        severity: "info",
        description:
          "若游戏内出现方块字或日文汉字缺失，请检查「启动设置」中的区域语言 (LC_ALL) 是否与游戏版本匹配（日文原版选 ja_JP.UTF-8，汉化版选 zh_CN.UTF-8）。",
      });
    }

    return hints;
  }, [logs, formData.envVars]);

  const handleClear = async () => {
    await BackendService.clearInstanceLogs(instanceId);
    setLogs([]);
    showToast("日志已清空", "info");
  };

  const handleCopy = async () => {
    const text = logs.map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.line}`).join("\n");
    try {
      await navigator.clipboard.writeText(text || "暂无日志");
      showToast("日志已复制到剪贴板", "success");
    } catch {
      showToast("复制失败", "error");
    }
  };

  const cardBase =
    "rounded-xl border border-slate-300/70 dark:border-white/[0.08] bg-white/85 dark:bg-[#1b1e28]/85 p-4 shadow-sm";

  return (
    <div className="space-y-4">
      {/* 调试选项与快捷配置 */}
      <div className={cardBase}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              <Wrench size={15} className="text-indigo-500" />
              运行排错
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              遇到闪退、黑屏或乱码时，可开启 Wine 调试输出或套用常用环境变量。
            </p>
          </div>

          {formData.runMode !== "parallels" && formData.runMode !== "direct" && (
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer select-none px-3 py-1.5 rounded-lg bg-slate-200/80 dark:bg-white/[0.06]">
              <Bug size={14} className={formData.wineDebug ? "text-amber-500" : "text-slate-500 dark:text-slate-400"} />
              <span>Wine 调试日志 (+err,+warn)</span>
              <input
                type="checkbox"
                checked={!!formData.wineDebug}
                onChange={(e) => onUpdateFormData({ wineDebug: e.target.checked })}
                className="w-3.5 h-3.5 accent-indigo-500 rounded"
              />
            </label>
          )}
        </div>

        {/* 快捷配置按钮栏 */}
        {formData.runMode !== "parallels" && formData.runMode !== "direct" && (
          <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-slate-200/80 dark:border-white/5">
            <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">快捷预设：</span>
            <button
              type="button"
              onClick={() => {
                onUpdateFormData({ locale: "ja_JP.UTF-8" });
                showToast("已切换为日语环境 (ja_JP.UTF-8)", "success");
              }}
              className={clsx(
                "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                formData.locale === "ja_JP.UTF-8"
                  ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-700 dark:text-indigo-300"
                  : "border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/5"
              )}
            >
              日语环境 (ja_JP)
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateFormData({ locale: "zh_CN.UTF-8" });
                showToast("已切换为中文环境 (zh_CN.UTF-8)", "success");
              }}
              className={clsx(
                "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                (!formData.locale || formData.locale === "zh_CN.UTF-8")
                  ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-700 dark:text-indigo-300"
                  : "border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/5"
              )}
            >
              中文环境 (zh_CN)
            </button>
            <button
              type="button"
              onClick={() => appendEnvVar("WINEDLLOVERRIDES=quartz,wmp,mfplat=d")}
              className="px-2.5 py-1 rounded-md text-xs font-medium border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/5 transition-colors"
            >
              跳过视频解码 (Quartz/WMP)
            </button>
            <button
              type="button"
              onClick={() => appendEnvVar("WINEDLLOVERRIDES=version,dsound,dinput8=n,b")}
              className="px-2.5 py-1 rounded-md text-xs font-medium border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/5 transition-colors"
            >
              本地补丁 DLL 优先
            </button>
          </div>
        )}
      </div>

      {/* 智能诊断结果提示 */}
      {diagnostics.length > 0 && (
        <div className="space-y-2">
          {diagnostics.map((d) => (
            <div
              key={d.id}
              className={clsx(
                "rounded-xl border p-3.5 flex items-start justify-between gap-3",
                d.severity === "error"
                  ? "bg-rose-500/10 border-rose-500/25 text-rose-700 dark:text-rose-200"
                  : d.severity === "warn"
                    ? "bg-amber-500/10 border-amber-500/25 text-amber-700 dark:text-amber-200"
                    : "bg-indigo-500/10 border-indigo-500/25 text-indigo-700 dark:text-indigo-200"
              )}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-semibold">{d.title}</div>
                  <div className="opacity-85 leading-relaxed">{d.description}</div>
                </div>
              </div>
              {d.actionLabel && d.onApply && (
                <button
                  onClick={d.onApply}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/20 transition-colors shadow-sm"
                >
                  {d.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 实时日志终端控制台 */}
      <div className="rounded-xl border border-slate-300/60 dark:border-white/[0.08] bg-[#13161f] text-slate-200 overflow-hidden shadow-inner">
        <div className="px-4 py-2.5 border-b border-white/10 bg-[#191d28] flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
            <Terminal size={14} className="text-indigo-400" />
            <span>实时运行日志 ({filteredLogs.length} 行)</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-black/30 rounded-lg p-0.5 text-[11px]">
              <button
                onClick={() => setFilterLevel("all")}
                className={clsx(
                  "px-2 py-0.5 rounded-md transition-colors",
                  filterLevel === "all" ? "bg-indigo-500/30 text-indigo-200 font-medium" : "text-slate-400 hover:text-white"
                )}
              >
                全部
              </button>
              <button
                onClick={() => setFilterLevel("warn")}
                className={clsx(
                  "px-2 py-0.5 rounded-md transition-colors",
                  filterLevel === "warn" ? "bg-amber-500/30 text-amber-200 font-medium" : "text-slate-400 hover:text-white"
                )}
              >
                警告+错误
              </button>
              <button
                onClick={() => setFilterLevel("error")}
                className={clsx(
                  "px-2 py-0.5 rounded-md transition-colors",
                  filterLevel === "error" ? "bg-rose-500/30 text-rose-200 font-medium" : "text-slate-400 hover:text-white"
                )}
              >
                仅错误
              </button>
            </div>

            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={clsx(
                "px-2 py-1 rounded-md text-[11px] border transition-colors flex items-center gap-1",
                autoScroll
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-white/10 text-slate-400 hover:text-white"
              )}
              title="自动滚动到底部"
            >
              <Filter size={11} /> 跟随
            </button>

            <button
              onClick={handleCopy}
              className="p-1.5 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              title="复制日志"
            >
              <Copy size={13} />
            </button>

            <button
              onClick={handleClear}
              className="p-1.5 rounded-md hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
              title="清空日志"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        <div
          ref={logContainerRef}
          className="h-[290px] overflow-y-auto p-3.5 font-mono text-xs space-y-1 custom-scrollbar select-text"
        >
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
              <Sparkles size={24} className="opacity-40" />
              <span>暂无运行日志，启动实例后将在此处实时输出进程状态与标准流</span>
            </div>
          ) : (
            filteredLogs.map((item, idx) => (
              <div
                key={idx}
                className={clsx(
                  "leading-relaxed break-all flex gap-2",
                  item.level === "error"
                    ? "text-rose-400"
                    : item.level === "warn"
                      ? "text-amber-300/90"
                      : item.level === "system"
                        ? "text-indigo-300 font-medium"
                        : "text-slate-300/90"
                )}
              >
                <span className="text-slate-500 shrink-0 select-none">[{item.timestamp}]</span>
                <span>{item.line}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {logs.length > 0 && diagnostics.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 px-1">
          <CheckCircle2 size={14} />
          <span>当前日志未检出常见崩溃特征</span>
        </div>
      )}
    </div>
  );
}
