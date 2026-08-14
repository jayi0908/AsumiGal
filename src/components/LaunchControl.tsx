import { useState } from "react";
import { Settings, ArrowLeftRight, Play, Box, History, Clock, Square } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import { GameInstance } from "./InstancesPage";
import { Tooltip } from "./Tooltip";
import { useTheme } from "../contexts/ThemeContext";

interface LaunchControlProps {
  instances: GameInstance[];
  onLaunch: (instance: GameInstance) => void;
  onGoToSettings: (instance: GameInstance) => void;
  onStop: (instance: GameInstance) => void;
  dryRunActive: boolean;
  dryRunInstanceId: string | null;
  onToggleDryRun: (instanceId: string) => void;
}

export function LaunchControl({ instances, onLaunch, onGoToSettings, onStop, dryRunActive, dryRunInstanceId, onToggleDryRun }: LaunchControlProps) {
  const { currentTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  // 简单起见，首页默认选第一个，或者你可以从 localStorage 读取上次选的
  const [selectedId, setSelectedId] = useState(instances[0]?.id);
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
    "text-xs font-bold uppercase tracking-wider mb-0.5",
    isDark ? "text-white/40" : "text-gray-500"
  );
  const statValueClass = clsx(
    "text-lg font-bold font-mono tracking-tight flex items-center gap-2",
    isDark ? "text-white/90" : "text-gray-800"
  );

  return (
    <div className="w-full flex items-end justify-between px-10 pb-8 relative z-30">
        {/* 上次运行 & 总时长 */}
        <div className="flex gap-8 pb-1 items-center">
          <div className="flex flex-col">
             <span className={statLabelClass}>上次运行</span>
             <div className={statValueClass}>
                 <History size={16} className={isDark ? "text-white/50" : "text-gray-400"} />
                 {getLastPlayedDate(currentInstance.lastPlayed)}
             </div>
          </div>
          <div className={clsx("w-px h-8", isDark ? "bg-white/10" : "bg-black/10")} />
          <div className="flex flex-col">
             <span className={statLabelClass}>总运行时长</span>
             <div className={statValueClass}>
                 {formatTime(currentInstance.totalPlayTime || 0)}
             </div>
          </div>
        </div>

        <div className="flex items-end gap-3">
          {/* 今日游玩时长 */}
          <Tooltip label={dryRunActive && dryRunInstanceId === currentInstance?.id ? "关闭 dry run" : "开启 dry run"} position="top">
            <button
              onClick={() => currentInstance && onToggleDryRun(currentInstance.id)}
              className={clsx(
                "relative h-20 rounded-2xl flex flex-col items-center justify-center px-6 transition-all border backdrop-blur-md overflow-hidden min-w-[100px] cursor-pointer group",
                dryRunActive && dryRunInstanceId === currentInstance?.id
                  ? (isDark ? "bg-black/60 border-green-500/30 shadow-lg shadow-green-500/10" : "bg-white/80 border-green-500/40 shadow-xl ring-1 ring-green-500/10")
                  : (isDark
                    ? "bg-black/60 border-white/10 shadow-lg group-hover:border-blue-500/30 group-hover:shadow-blue-500/5"
                    : "bg-white/80 border-white/60 shadow-xl ring-1 ring-black/5 group-hover:border-blue-500/30")
              )}
            >
            <div className={clsx(
              "absolute inset-x-0 bottom-0 h-full bg-gradient-to-t opacity-0 group-hover:opacity-100 transition-opacity duration-500",
              dryRunActive && dryRunInstanceId === currentInstance?.id
                ? "from-green-600/20 to-transparent"
                : "from-blue-600/20 to-transparent"
            )} />
            <span className={clsx("text-xs font-bold uppercase tracking-wider mb-1", isDark ? "text-white/50" : "text-gray-500")}>今日游玩</span>
            <div className="flex items-center gap-2">
               <Clock size={16} className={clsx(
                 dryRunActive && dryRunInstanceId === currentInstance?.id
                   ? "text-green-500 animate-pulse"
                   : "text-blue-500"
               )} />
               <span className={clsx(
                 "text-xl font-bold font-mono",
                 dryRunActive && dryRunInstanceId === currentInstance?.id
                   ? (isDark ? "text-green-400" : "text-green-600")
                   : (isDark ? "text-blue-400" : "text-blue-600")
               )}>
                   {formatTime(getDailyTime(currentInstance))}
               </span>
            </div>
            <div className={clsx(
              "absolute inset-x-0 bottom-0 h-1 transition-colors duration-300",
              dryRunActive && dryRunInstanceId === currentInstance?.id
                ? "bg-green-500/50"
                : "bg-blue-500/50"
            )} />
          </button>
          </Tooltip>

          {/* 启动按钮组容器 */}
          <div className="relative group">
            {/* 快速切换列表 */}
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute bottom-full right-0 mb-3 w-64 bg-[#1e1e2e]/90 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-2xl z-40"
                >
                   <div className="max-h-[200px] overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {instances.map((instance) => (
                      <button
                        key={instance.id}
                        onClick={() => { setSelectedId(instance.id); setIsOpen(false); }}
                        className={clsx(
                          "w-full flex items-center gap-3 p-2 rounded-lg transition-all text-left group border",
                          selectedId === instance.id
                            ? "bg-white/10 border-white/10"
                            : "hover:bg-white/5 border-transparent"
                        )}
                      >
                        <Box size={16} className="text-indigo-300" />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm truncate text-white">{instance.name}</div>
                          <div className="text-xs text-white/40 truncate">{instance.info}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          
            <div className="relative group">
              <button
                onClick={() => currentInstance && onLaunch(currentInstance)}
                className="relative w-56 h-20 bg-black/60 backdrop-blur-md rounded-2xl overflow-hidden border border-white/10 group-hover:border-indigo-500/50 transition-all duration-300 shadow-xl"
              >
                  <div className="absolute inset-x-0 bottom-0 h-full bg-gradient-to-t from-indigo-600/20 to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-500" />
                  <div className="absolute inset-0 flex items-center pl-6 pr-16">
                      <div className="flex flex-col items-start text-left w-full">
                          <div className="text-xl font-bold text-white tracking-wide truncate w-full">启动游戏</div>
                          <div className="text-xs text-indigo-200/70 font-medium mt-1 truncate w-full">
                              {currentInstance ? currentInstance.name : "无实例"}
                          </div>
                      </div>
                  </div>
                  <div className="absolute right-4 bottom-4">
                     <Play fill="currentColor" className="w-6 h-6 text-white group-hover:scale-110 transition-all" />
                  </div>
              </button>

              <div className="absolute top-2 right-2 flex gap-1 bg-black/20 backdrop-blur rounded-lg p-0.5 border border-white/5 transition-opacity duration-200">
                  <ToolBtn label="打开实例设置" icon={<Settings size={12} />} onClick={handleOpenCurrentSettings} />
                  <ToolBtn label="切换游戏实例" icon={<ArrowLeftRight size={12} />} onClick={() => setIsOpen(!isOpen)} active={isOpen} />
                  <ToolBtn label="终止当前实例" icon={<Square size={12} />} onClick={handleStopInstance} />
              </div>
            </div>
          </div>
        </div>
      </div>
  );
}

function ToolBtn({ label, icon, onClick, active }: { label: string; icon: any; onClick: () => void; active?: boolean }) {
  return (
    <Tooltip label={label} position="top">
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={clsx(
          "w-6 h-6 rounded flex items-center justify-center transition-all",
          active ? "bg-indigo-500 text-white shadow-sm" : "text-white/40 hover:text-white hover:bg-white/10"
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
