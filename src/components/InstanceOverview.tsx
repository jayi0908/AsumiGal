import { useState, useEffect, useMemo } from "react";
import {
  Clock,
  Calendar,
  Flame,
  Camera,
  SlidersHorizontal,
  Terminal,
  FolderOpen,
  HardDrive,
  Laptop,
  Box,
  ArrowUpRight,
  Image as ImageIcon,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { GameInstance, ScreenshotItem } from "../types/instance";
import clsx from "clsx";

interface InstanceOverviewProps {
  instance: Partial<GameInstance>;
  screenshots: ScreenshotItem[];
  onSwitchTab: (tab: "basic" | "launch" | "screenshots" | "logs") => void;
  onOpenFolder: () => void;
  onPreviewScreenshot: (shot: ScreenshotItem) => void;
}

export function InstanceOverview({
  instance,
  screenshots,
  onSwitchTab,
  onOpenFolder,
  onPreviewScreenshot,
}: InstanceOverviewProps) {
  const [slideIdx, setSlideIdx] = useState(0);

  // 自动轮播截图相册（参考 SJMCL InstanceScreenshotsWidget）
  useEffect(() => {
    setSlideIdx(0);
  }, [instance.id, screenshots.length]);

  useEffect(() => {
    if (screenshots.length < 2) return;
    const timer = setInterval(() => {
      setSlideIdx((prev) => (prev + 1) % screenshots.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [screenshots.length]);

  const formatDuration = (sec?: number) => {
    if (!sec || sec <= 0) return "0 分钟";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h} 小时 ${m} 分`;
    if (m > 0) return `${m} 分钟`;
    return `${sec} 秒`;
  };

  const formatLastPlayed = (ts?: number) => {
    if (!ts) return "尚未运行";
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return `今天 ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
    }
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
  };

  // 计算游玩统计与最近 24 周 (168 天) 的日历热力图数据
  const heatmapStats = useMemo(() => {
    const history = instance.playHistory || {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 对齐到本周日结束，共展示 24 列 (24 周)
    const dayOfWeek = today.getDay(); // 0 (Sun) - 6 (Sat)
    const totalWeeks = 24;
    const totalDays = totalWeeks * 7;
    const endDay = new Date(today);
    endDay.setDate(today.getDate() + (6 - dayOfWeek));

    const weeks: {
      dateKey: string;
      label: string;
      seconds: number;
      level: 0 | 1 | 2 | 3 | 4;
      isFuture: boolean;
    }[][] = [];

    let activeDays = 0;
    let weekSeconds = 0;
    let maxDailySeconds = 0;

    for (let w = totalWeeks - 1; w >= 0; w--) {
      const col: {
        dateKey: string;
        label: string;
        seconds: number;
        level: 0 | 1 | 2 | 3 | 4;
        isFuture: boolean;
      }[] = [];

      for (let d = 6; d >= 0; d--) {
        const offset = w * 7 + d;
        const cellDate = new Date(endDay);
        cellDate.setDate(endDay.getDate() - offset);
        const dateKey = cellDate.toLocaleDateString("en-CA");
        const isFuture = cellDate.getTime() > today.getTime();
        const sec = isFuture ? 0 : history[dateKey] || 0;

        if (sec > 0) {
          activeDays++;
          if (sec > maxDailySeconds) maxDailySeconds = sec;
        }

        const diffDays = Math.floor((today.getTime() - cellDate.getTime()) / 86400000);
        if (!isFuture && diffDays >= 0 && diffDays < 7) {
          weekSeconds += sec;
        }

        let level: 0 | 1 | 2 | 3 | 4 = 0;
        if (sec > 0 && sec < 15 * 60) level = 1;
        else if (sec >= 15 * 60 && sec < 45 * 60) level = 2;
        else if (sec >= 45 * 60 && sec < 120 * 60) level = 3;
        else if (sec >= 120 * 60) level = 4;

        col.unshift({
          dateKey,
          label: `${dateKey} · ${formatDuration(sec)}`,
          seconds: sec,
          level,
          isFuture,
        });
      }
      weeks.push(col);
    }

    // 计算总活跃天数（含 24 周以前）
    const totalActiveDays = Object.values(history).filter((s) => s > 0).length;

    return {
      weeks,
      activeDays: totalActiveDays || activeDays,
      weekSeconds,
      maxDailySeconds,
      totalDays,
    };
  }, [instance.playHistory]);

  const runModeLabel =
    instance.runMode === "parallels"
      ? "Parallels Desktop"
      : instance.runMode === "direct"
        ? "Direct (macOS Native)"
        : "CrossOver (Wine)";

  const currentShot = screenshots[slideIdx] || screenshots[0];

  const cardBase =
    "rounded-xl border border-slate-300/70 dark:border-white/[0.08] bg-white/85 dark:bg-[#1b1e28]/85 p-4 shadow-sm transition-all";

  return (
    <div className="space-y-4">
      {/* 顶部三栏核心指标卡片 */}
      <div className="grid grid-cols-3 gap-3.5">
        <div className={cardBase}>
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1.5">
            <span>总游玩时长</span>
            <Clock size={14} className="text-indigo-500" />
          </div>
          <div className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {formatDuration(instance.totalPlayTime)}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
            近 7 日 {formatDuration(heatmapStats.weekSeconds)}
          </div>
        </div>

        <div className={cardBase}>
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1.5">
            <span>最近运行</span>
            <Calendar size={14} className="text-emerald-500" />
          </div>
          <div className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate">
            {formatLastPlayed(instance.lastPlayed)}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1">
            共 {heatmapStats.activeDays} 天
          </div>
        </div>

        <div className={cardBase}>
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 mb-1.5">
            <span>运行环境</span>
            <Flame size={14} className="text-amber-500" />
          </div>
          <div className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate">
            {runModeLabel}
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1.5 flex items-center gap-1.5 truncate">
            {instance.gameFileStatus === "disk" ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium">
                <HardDrive size={11} /> 硬盘
              </span>
            ) : instance.gameFileStatus === "local" ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-medium">
                <Laptop size={11} /> 本机
              </span>
            ) : null}
            <span className="truncate">
              {instance.bottleName || (instance.runMode === "direct" ? "无前置脚本" : "默认容器")}
            </span>
          </div>
        </div>
      </div>

      {/* 游玩热力图 */}
      <div className={cardBase}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              游玩记录
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              近 24 周（单日最高 {formatDuration(heatmapStats.maxDailySeconds)}）
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span>少</span>
            <span className="w-2.5 h-2.5 rounded-[3px] bg-slate-200 dark:bg-white/[0.06]" />
            <span className="w-2.5 h-2.5 rounded-[3px] bg-indigo-500/30" />
            <span className="w-2.5 h-2.5 rounded-[3px] bg-indigo-500/55" />
            <span className="w-2.5 h-2.5 rounded-[3px] bg-indigo-500/80" />
            <span className="w-2.5 h-2.5 rounded-[3px] bg-indigo-600" />
            <span>多</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-1">
          <div className="flex flex-col justify-between h-[88px] pr-1 text-[10px] text-slate-400 select-none shrink-0">
            <span>一</span>
            <span>三</span>
            <span>五</span>
            <span>日</span>
          </div>
          <div className="flex gap-[4px] flex-1 justify-between min-w-[440px]">
            {heatmapStats.weeks.map((week, wIdx) => (
              <div key={wIdx} className="flex flex-col gap-[4px]">
                {week.map((cell) => (
                  <div
                    key={cell.dateKey}
                    title={cell.isFuture ? "" : cell.label}
                    className={clsx(
                      "w-2.5 h-2.5 rounded-[3px] transition-transform",
                      !cell.isFuture && "hover:scale-125",
                      cell.isFuture
                        ? "opacity-0 pointer-events-none"
                        : cell.level === 0
                          ? "bg-slate-200/80 dark:bg-white/[0.06]"
                          : cell.level === 1
                            ? "bg-indigo-500/30 dark:bg-indigo-400/30"
                            : cell.level === 2
                              ? "bg-indigo-500/55 dark:bg-indigo-400/55"
                              : cell.level === 3
                                ? "bg-indigo-500/80 dark:bg-indigo-400/80"
                                : "bg-indigo-600 dark:bg-indigo-400"
                    )}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 下半部分：截图轮播卡片 + 快捷入口与环境摘要 (参考 SJMCL Instance Overview Widgets) */}
      <div className="grid grid-cols-5 gap-3.5">
        {/* 截图相册轮播小组件 */}
        <div className={clsx(cardBase, "col-span-3 flex flex-col justify-between")}>
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Camera size={14} className="text-indigo-500" />
              截图 ({screenshots.length})
            </span>
            <button
              onClick={() => onSwitchTab("screenshots")}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5"
            >
              管理 <ArrowUpRight size={12} />
            </button>
          </div>

          {currentShot ? (
            <div
              onClick={() => onPreviewScreenshot(currentShot)}
              className="group relative aspect-video w-full rounded-lg overflow-hidden bg-slate-900/20 cursor-pointer border border-slate-300/40 dark:border-white/5"
            >
              <img
                key={currentShot.filePath}
                src={convertFileSrc(currentShot.filePath)}
                alt={currentShot.fileName}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 py-2 flex items-center justify-between">
                <span className="text-[11px] text-white/90 truncate">{currentShot.fileName}</span>
                {screenshots.length > 1 && (
                  <div className="flex items-center gap-1">
                    {screenshots.slice(0, 6).map((_, idx) => (
                      <span
                        key={idx}
                        className={clsx(
                          "w-1.5 h-1.5 rounded-full transition-all",
                          idx === slideIdx % Math.min(screenshots.length, 6)
                            ? "bg-white w-3"
                            : "bg-white/40"
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              onClick={() => onSwitchTab("screenshots")}
              className="aspect-video w-full rounded-lg border border-dashed border-slate-300 dark:border-white/10 flex flex-col items-center justify-center text-slate-400 hover:border-indigo-500/40 hover:text-indigo-500 transition-colors cursor-pointer"
            >
              <ImageIcon size={28} className="mb-1.5 opacity-50" />
              <span className="text-xs">暂无游戏截图，点击前往截图页</span>
            </div>
          )}
        </div>

        {/* 右侧：实例信息与快捷入口 */}
        <div className={clsx(cardBase, "col-span-2 flex flex-col justify-between")}>
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Box size={14} className="text-indigo-500" />
              实例信息
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="text-slate-500 dark:text-slate-400">可执行文件</div>
              <div
                className="font-mono text-[11px] text-slate-800 dark:text-slate-300 bg-slate-200/70 dark:bg-black/25 px-2.5 py-1.5 rounded-md truncate"
                title={instance.executablePath || "未设置"}
              >
                {instance.executablePath || "未设置"}
              </div>
            </div>

            {instance.info && (
              <div className="space-y-1 text-xs">
                <div className="text-slate-500 dark:text-slate-400">备注</div>
                <p className="text-slate-700 dark:text-slate-300 line-clamp-2 leading-relaxed">
                  {instance.info}
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-200/80 dark:border-white/5 mt-3">
            <button
              onClick={() => onSwitchTab("basic")}
              className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-200/70 dark:bg-white/[0.06] hover:bg-indigo-500/15 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              <SlidersHorizontal size={13} /> 基本信息
            </button>
            <button
              onClick={() => onSwitchTab("logs")}
              className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-200/70 dark:bg-white/[0.06] hover:bg-indigo-500/15 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              <Terminal size={13} /> 运行日志
            </button>
            <button
              onClick={() => onSwitchTab("launch")}
              className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-200/70 dark:bg-white/[0.06] hover:bg-indigo-500/15 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              <HardDrive size={13} /> 启动设置
            </button>
            <button
              onClick={onOpenFolder}
              className="flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-200/70 dark:bg-white/[0.06] hover:bg-indigo-500/15 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
            >
              <FolderOpen size={13} /> 打开目录
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
