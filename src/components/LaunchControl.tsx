import { useState } from "react";
import { Settings, ArrowLeftRight, Play, Box, History, Clock, Square } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { GameInstance } from "./InstancesPage";
import { Tooltip } from "./Tooltip";
import { useTheme } from "../contexts/ThemeContext";
import liquidGlassStyles from "../styles/liquid-glass.module.css";

interface LaunchControlProps {
  instances: GameInstance[];
  selectedId?: string | null;
  onSelectInstance?: (id: string) => void;
  onLaunch: (instance: GameInstance) => void;
  onGoToSettings: (instance: GameInstance) => void;
  onStop: (instance: GameInstance) => void;
  dryRunActive: boolean;
  dryRunInstanceId: string | null;
  onToggleDryRun: (instanceId: string) => void;
}

export function LaunchControl({
  instances,
  selectedId: controlledSelectedId,
  onSelectInstance,
  onLaunch,
  onGoToSettings,
  onStop,
  dryRunActive,
  dryRunInstanceId,
  onToggleDryRun,
}: LaunchControlProps) {
  const { currentTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [internalSelectedId, setInternalSelectedId] = useState(instances[0]?.id);
  const selectedId = controlledSelectedId ?? internalSelectedId ?? instances[0]?.id;
  const setSelectedId = (id: string) => {
    setInternalSelectedId(id);
    onSelectInstance?.(id);
  };
  const currentInstance = instances.find((i) => i.id === selectedId) || instances[0];

  // 格式化时间辅助函数
  const formatTime = (seconds: number) => {
    if (!seconds) return "0分钟";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}小时${m}分`;
    return `${m}分钟`;
  };

  const getLastPlayedDate = (ts?: number) => {
    if (!ts) return "从未运行";
    const date = new Date(ts);
    const now = new Date();
    // 简单的日期判断
    if (date.toDateString() === now.toDateString()) return "今天";
    return date.toLocaleDateString();
  };

  // 获取今日游玩时长
  const getDailyTime = (inst?: GameInstance) => {
    if (!inst || !inst.playHistory) return 0;
    const todayKey = new Date().toLocaleDateString("en-CA");
    return inst.playHistory[todayKey] || 0;
  };

  const handleStopInstance = () => {
    if (currentInstance) {
      onStop(currentInstance);
    }
  };

  const handleOpenCurrentSettings = () => {
    if (currentInstance) {
      onGoToSettings(currentInstance);
    }
  };

  if (!currentInstance) return null;

  const isDark = currentTheme === 'dark';

  const statLabelClass = clsx(
    "text-xs font-semibold tracking-wider mb-0.5",
    isDark ? "text-white/50" : "text-slate-700/80"
  );
  const statValueClass = clsx(
    "text-lg font-bold font-mono tracking-tight flex items-center gap-2",
    isDark ? "text-white/95 drop-shadow-sm" : "text-slate-900"
  );

  return (
    <div className="w-full flex items-end justify-between px-10 pb-8 relative z-30">
        {/* 上次运行 & 总时长 */}
        <div className={clsx(
          "flex gap-7 items-center px-4 py-2.5 rounded-2xl transition-colors",
          isDark ? "" : "bg-white/45 backdrop-blur-md border border-white/60 shadow-sm"
        )}>
          <div className="flex flex-col">
             <span className={statLabelClass}>上次运行</span>
             <div className={statValueClass}>
                 <History size={16} className={isDark ? "text-white/60" : "text-slate-600"} />
                 {getLastPlayedDate(currentInstance.lastPlayed)}
             </div>
          </div>
          <div className={clsx("w-px h-8", isDark ? "bg-white/15" : "bg-slate-900/15")} />
          <div className="flex flex-col">
             <span className={statLabelClass}>总运行时长</span>
             <div className={statValueClass}>
                 {formatTime(currentInstance.totalPlayTime || 0)}
             </div>
          </div>
        </div>

        <div className="flex items-end gap-3">
          {/* 今日游玩时长 */}
          <Tooltip label={dryRunActive && dryRunInstanceId === currentInstance?.id ? "关闭计时" : "开启手动计时"} position="top">
            <button
              onClick={() => currentInstance && onToggleDryRun(currentInstance.id)}
              className={clsx(
                "h-20 rounded-2xl flex flex-col items-center justify-center px-6 transition-all border overflow-hidden min-w-[100px] cursor-pointer group",
                liquidGlassStyles["wrapper"],
                dryRunActive && dryRunInstanceId === currentInstance?.id
                  ? (isDark ? "border-emerald-500/35 shadow-lg shadow-emerald-500/10" : "border-emerald-500/45 shadow-lg ring-1 ring-emerald-500/15")
                  : (isDark
                    ? "border-white/10 shadow-lg group-hover:border-indigo-400/35"
                    : "border-slate-300/70 shadow-lg group-hover:border-indigo-500/40")
              )}
            >
            <div className={liquidGlassStyles["effect"]} />
            <div className={liquidGlassStyles["shine"]} />
            <div className={clsx(
              "absolute inset-x-0 bottom-0 h-full bg-gradient-to-t opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-[3]",
              dryRunActive && dryRunInstanceId === currentInstance?.id
                ? "from-emerald-500/15 to-transparent"
                : "from-indigo-500/15 to-transparent"
            )} />
            <div className="relative z-[3] flex flex-col items-center justify-center">
              <span className={clsx("text-xs font-semibold tracking-wider mb-1", isDark ? "text-white/55" : "text-slate-600")}>今日游玩</span>
              <div className="flex items-center gap-2">
                 <Clock size={16} className={clsx(
                   dryRunActive && dryRunInstanceId === currentInstance?.id
                     ? "text-emerald-500 animate-pulse"
                     : isDark ? "text-indigo-400" : "text-indigo-600"
                 )} />
                 <span className={clsx(
                   "text-xl font-bold font-mono",
                   dryRunActive && dryRunInstanceId === currentInstance?.id
                     ? (isDark ? "text-emerald-400" : "text-emerald-700")
                     : (isDark ? "text-indigo-300" : "text-indigo-700")
                 )}>
                     {formatTime(getDailyTime(currentInstance))}
                 </span>
              </div>
            </div>
            <div className={clsx(
              "absolute inset-x-0 bottom-0 h-1 transition-colors duration-300 z-[3]",
              dryRunActive && dryRunInstanceId === currentInstance?.id
                ? "bg-emerald-500/60"
                : "bg-indigo-500/50"
            )} />
          </button>
          </Tooltip>

          {/* 启动按钮组容器 */}
          <div className="relative group">
            {/* 快速切换列表 */}
            <AnimatePresence>
              {isOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setIsOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    className={clsx(
                      "absolute bottom-full right-0 mb-3 w-64 backdrop-blur-xl border rounded-xl overflow-hidden shadow-2xl z-40",
                      isDark
                        ? "bg-[#1b1e28]/95 border-white/10"
                        : "bg-white/95 border-slate-300/80"
                    )}
                  >
                     <div className="max-h-[220px] overflow-y-auto p-1.5 space-y-1 custom-scrollbar">
                      {instances.map((instance) => (
                        <button
                          key={instance.id}
                          onClick={() => { setSelectedId(instance.id); setIsOpen(false); }}
                          className={clsx(
                            "w-full flex items-center gap-2.5 p-2 rounded-lg transition-all text-left border",
                            selectedId === instance.id
                              ? (isDark
                                  ? "bg-indigo-500/20 border-indigo-400/30"
                                  : "bg-indigo-500/10 border-indigo-500/25")
                              : (isDark
                                  ? "hover:bg-white/5 border-transparent"
                                  : "hover:bg-slate-900/5 border-transparent")
                          )}
                        >
                          <Box size={15} className={isDark ? "text-indigo-300 shrink-0" : "text-indigo-600 shrink-0"} />
                          <div className="flex-1 min-w-0">
                            <div className={clsx("font-semibold text-sm truncate", isDark ? "text-slate-100" : "text-slate-800")}>
                              {instance.name}
                            </div>
                            {instance.info && (
                              <div className={clsx("text-xs truncate", isDark ? "text-slate-400" : "text-slate-500")}>
                                {instance.info}
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          
            <div className="relative group">
              <button
                onClick={() => currentInstance && onLaunch(currentInstance)}
                className={clsx(
                  "w-56 h-20 overflow-hidden border transition-all duration-300 cursor-pointer group",
                  liquidGlassStyles["wrapper"],
                  isDark
                    ? "border-white/10 group-hover:border-indigo-400/50 shadow-lg"
                    : "border-slate-300/70 group-hover:border-indigo-500/50 shadow-lg"
                )}
              >
                  <div className={liquidGlassStyles["effect"]} />
                  <div className={liquidGlassStyles["shine"]} />
                  <div className={clsx(
                    "absolute inset-x-0 bottom-0 h-full bg-gradient-to-t transition-opacity duration-500 z-[3]",
                    isDark
                      ? "from-indigo-600/25 to-transparent opacity-50 group-hover:opacity-100"
                      : "from-indigo-500/15 to-transparent opacity-60 group-hover:opacity-100"
                  )} />
                  <div className="absolute inset-0 flex items-center pl-5 pr-14 z-[3]">
                      <div className="flex flex-col items-start text-left w-full">
                          <div className={clsx(
                            "text-xl font-bold tracking-wide truncate w-full",
                            isDark ? "text-white" : "text-slate-900"
                          )}>
                            启动游戏
                          </div>
                          <div className={clsx(
                            "text-xs font-medium mt-0.5 truncate w-full",
                            isDark ? "text-indigo-200/80" : "text-indigo-700/85"
                          )}>
                              {currentInstance ? currentInstance.name : "无实例"}
                          </div>
                      </div>
                  </div>
                  <div className="absolute right-4 bottom-4 z-[3]">
                     <Play
                       fill="currentColor"
                       className={clsx(
                         "w-5 h-5 group-hover:scale-110 transition-all",
                         isDark ? "text-white" : "text-indigo-600"
                       )}
                     />
                  </div>
              </button>

              <div className={clsx(
                "absolute top-2 right-2 flex gap-0.5 backdrop-blur rounded-lg p-0.5 border transition-opacity duration-200 z-[5]",
                isDark
                  ? "bg-black/25 border-white/10"
                  : "bg-slate-900/[0.06] border-slate-900/10"
              )}>
                  <ToolBtn label="实例设置" icon={<Settings size={12} />} onClick={handleOpenCurrentSettings} isDark={isDark} />
                  <ToolBtn label="切换实例" icon={<ArrowLeftRight size={12} />} onClick={() => setIsOpen(!isOpen)} active={isOpen} isDark={isDark} />
                  <ToolBtn label="终止运行" icon={<Square size={12} />} onClick={handleStopInstance} isDark={isDark} />
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}

function ToolBtn({ label, icon, onClick, active, isDark }: { label: string; icon: any; onClick: () => void; active?: boolean; isDark: boolean }) {
  return (
    <Tooltip label={label} position="top">
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={clsx(
          "w-6 h-6 rounded flex items-center justify-center transition-all",
          active
            ? "bg-indigo-600 text-white shadow-sm"
            : isDark
              ? "text-white/55 hover:text-white hover:bg-white/10"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-900/10"
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
