import { useState, useEffect, useRef, useCallback } from "react";
import { Layout } from "./components/Layout";
import { LaunchControl } from "./components/LaunchControl";
import { InstancesPage, GameInstance, DetailTab } from "./components/InstancesPage";
import { DiscoveryPage } from "./components/DiscoveryPage";
import { SettingsPage } from "./components/SettingsPage";
import { ToastProvider, useToast } from "./components/ToastProvider";
import { useTheme, ThemeProvider } from "./contexts/ThemeContext";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { BackendService } from "./services/backend";

const INITIAL_INSTANCES: GameInstance[] = [];

function AppContent() {
  const [activeTab, setActiveTab] = useState<"home" | "instances" | "discovery" | "settings">("home");
  const [instances, setInstances] = useState<GameInstance[]>([]);
  const [instanceSettingsTargetId, setInstanceSettingsTargetId] = useState<string | null>(null);
  const [instanceSettingsTargetTab, setInstanceSettingsTargetTab] = useState<DetailTab | null>(null);
  const [focusInstanceId, setFocusInstanceId] = useState<string | null>(null);
  const { config, currentTheme } = useTheme();
  const isDark = currentTheme === "dark";
  const { showToast } = useToast();
  const isLoaded = useRef(false);
  const [dryRunActive, setDryRunActive] = useState(false);
  const [dryRunInstanceId, setDryRunInstanceId] = useState<string | null>(null);
  const dryRunIntervalRef = useRef<number | null>(null);
  const autoPopupCrashRef = useRef(config.autoPopupCrashLog);
  autoPopupCrashRef.current = config.autoPopupCrashLog;

  // 辅助函数：对实例列表进行排序（最近启动的在最前，然后是新建的）
  const sortInstances = (list: GameInstance[]) => {
    return [...list].sort((a, b) => {
        // 如果有 lastPlayed，按时间倒序
        const timeA = a.lastPlayed || 0;
        const timeB = b.lastPlayed || 0;
        if (timeA !== timeB) return timeB - timeA;
        // 否则按 ID 倒序（通常意味着按创建时间）
        return b.id.localeCompare(a.id);
    });
  };

  // 核心数据加载函数
  const loadInstancesData = async (isManual = false) => {
    try {
      console.log("正在从后端读取实例数据...");
      const loadedData = await BackendService.loadInstances();

      if (Array.isArray(loadedData)) {
        const sorted = sortInstances(loadedData);
        setInstances(sorted);
        if (isManual) {
          showToast("数据已刷新", "success");
        }
      } else {
        setInstances(INITIAL_INSTANCES);
      }
    } catch (e) {
      console.error("加载失败:", e);
      showToast("数据加载失败", "error");
    }
  };

  useEffect(() => {
    if (!isLoaded.current) {
      isLoaded.current = true;
      loadInstancesData(false);
    }
  }, []);

  const handleUpdateInstances = async (newInstances: GameInstance[]) => {
    const sorted = sortInstances(newInstances);
    setInstances(sorted);
    try {
      await BackendService.saveInstances(sorted);
    } catch (e) { console.error(e); }
  };

  const saveInstancesSnapshot = useCallback((list: GameInstance[]) => {
    BackendService.saveInstances(list).catch((e) => console.error(e));
  }, []);

  const handleToggleDryRun = useCallback((instanceId: string) => {
    if (dryRunActive && dryRunInstanceId === instanceId) {
      if (dryRunIntervalRef.current !== null) {
        clearInterval(dryRunIntervalRef.current);
        dryRunIntervalRef.current = null;
      }
      setInstances((prev) => {
        saveInstancesSnapshot(prev);
        return prev;
      });
      setDryRunActive(false);
      setDryRunInstanceId(null);
    } else if (dryRunActive && dryRunInstanceId !== instanceId) {
      if (dryRunIntervalRef.current !== null) {
        clearInterval(dryRunIntervalRef.current);
        dryRunIntervalRef.current = null;
      }
      setInstances((prev) => {
        saveInstancesSnapshot(prev);
        return prev;
      });
      setDryRunInstanceId(instanceId);
      dryRunIntervalRef.current = window.setInterval(() => {
        setInstances((prev) => {
          const todayKey = new Date().toLocaleDateString("en-CA");
          return prev.map((inst) => {
            if (inst.id === instanceId) {
              const currentHistory = inst.playHistory || {};
              return {
                ...inst,
                totalPlayTime: (inst.totalPlayTime || 0) + 1,
                playHistory: { ...currentHistory, [todayKey]: (currentHistory[todayKey] || 0) + 1 },
              };
            }
            return inst;
          });
        });
      }, 1000);
    } else {
      setDryRunActive(true);
      setDryRunInstanceId(instanceId);
      dryRunIntervalRef.current = window.setInterval(() => {
        setInstances((prev) => {
          const todayKey = new Date().toLocaleDateString("en-CA");
          return prev.map((inst) => {
            if (inst.id === instanceId) {
              const currentHistory = inst.playHistory || {};
              return {
                ...inst,
                totalPlayTime: (inst.totalPlayTime || 0) + 1,
                playHistory: { ...currentHistory, [todayKey]: (currentHistory[todayKey] || 0) + 1 },
              };
            }
            return inst;
          });
        });
      }, 1000);
    }
  }, [dryRunActive, dryRunInstanceId, saveInstancesSnapshot]);

  const gameFinishedGenRef = useRef(0);

  useEffect(() => {
    const generation = ++gameFinishedGenRef.current;

    const unlistenPromise = listen<{ instance_id: string; duration_sec: number }>("game-finished", (event) => {
      if (gameFinishedGenRef.current !== generation) return;
      const { instance_id, duration_sec } = event.payload;
      console.log(`收到游戏结束事件: ID=${instance_id}, 时长=${duration_sec}s`);

      // 如果启动器被自动最小化或隐藏，在游戏退出后恢复显示
      getCurrentWindow().unminimize().catch(() => {});
      getCurrentWindow().show().catch(() => {});

      // 若游戏启动后 6 秒内意外退出且开启了闪退诊断自动跳转，打开该实例的日志与诊断页
      if (duration_sec > 0 && duration_sec <= 6 && (autoPopupCrashRef.current ?? true)) {
        showToast("检测到游戏在启动后快速退出，已打开运行日志与排错诊断", "info");
        setInstanceSettingsTargetId(instance_id);
        setInstanceSettingsTargetTab("logs");
        setActiveTab("instances");
      }

      setInstances((prevInstances) => {
        const todayKey = new Date().toLocaleDateString("en-CA");
        
        const newInstances = prevInstances.map((inst) => {
          if (inst.id === instance_id) {
            const currentHistory = inst.playHistory || {};
            const todayTime = (currentHistory[todayKey] || 0) + duration_sec;
            
            return {
              ...inst,
              totalPlayTime: (inst.totalPlayTime || 0) + duration_sec,
              playHistory: { ...currentHistory, [todayKey]: todayTime },
            };
          }
          return inst;
        });
        
        BackendService.saveInstances(newInstances).catch((e) => console.error(e));
        return newInstances;
      });
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  const handleLaunch = async (instance: GameInstance) => {
    try {
      const isDryRun = dryRunActive && dryRunInstanceId === instance.id;
      const bottlePath = instance.runMode === 'parallels'
        ? `${config.pdPath}/${instance.bottleName}`
        : instance.runMode === 'direct'
          ? instance.bottleName
          : `${config.bottlesPath}/${instance.bottleName}`;
      const response = await BackendService.launchGame(instance.id, {
        bottle_path: bottlePath,
        game_exe: instance.executablePath,
        crossover_app_path: config.crossoverPath,
        run_mode: instance.runMode || 'crossover',
        dry_run_active: isDryRun,
        command_args: instance.commandArgs || '',
        env_vars: instance.envVars || '',
        work_dir: instance.workDir || '',
        screenshot_dir: instance.screenshotCustomDir ? (instance.screenshotRootDir || '').trim() : '',
        screenshot_target: instance.screenshotTarget === 'focused' ? 'focused' : 'game',
        locale: instance.locale || config.defaultLocale || 'zh_CN.UTF-8',
        wine_debug: (instance.wineDebug || config.enableWineDebugLog) ? '+err,+warn' : '-all',
      });
      showToast(`${instance.name} 启动成功 (PID: ${response})`, "success");

      if (config.onGameLaunchAction === "minimize") {
        getCurrentWindow().minimize().catch(() => {});
      } else if (config.onGameLaunchAction === "hide") {
        getCurrentWindow().hide().catch(() => {});
      }

      // 启动后将该实例设为「当前实例」，使全局截图在无法从焦点窗口归属时也能落到刚启动的实例目录
      setActiveInstanceId(instance.id);

      setInstances((prev) => {
        const now = Date.now();
        const sorted = prev.map((i) =>
          i.id === instance.id ? { ...i, lastPlayed: now } : i
        ).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
        BackendService.saveInstances(sorted).catch((e) => console.error(e));
        return sorted;
      });
    } catch (error) {
      console.error("启动异常:", error);
      showToast(`${error}`, "error");
    }
  };
  const handleLaunchRef = useRef(handleLaunch);
  handleLaunchRef.current = handleLaunch;

  // 当前选中的实例（由 InstancesPage 上抛，跨 tab 与跨重启保持），供全局快捷键截屏读取其截图配置
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(() => {
    try { return localStorage.getItem("asumigal_active_instance_id"); } catch { return null; }
  });
  useEffect(() => {
    try {
      if (activeInstanceId) localStorage.setItem("asumigal_active_instance_id", activeInstanceId);
      else localStorage.removeItem("asumigal_active_instance_id");
    } catch { /* ignore */ }
  }, [activeInstanceId]);
  const activeInstance = activeInstanceId ? instances.find(i => i.id === activeInstanceId) : undefined;

  const handleGlobalCapture = async () => {
    try {
      const res = await BackendService.captureGameScreenshot({
        activeInstanceId: activeInstance?.id || "",
        activeRunMode: activeInstance?.runMode || "crossover",
        activeExecutablePath: activeInstance?.executablePath || "",
        activeScreenshotDir: activeInstance?.screenshotCustomDir ? (activeInstance.screenshotRootDir || "").trim() : "",
        activeScreenshotTarget: activeInstance?.screenshotTarget === "focused" ? "focused" : "game"
      });
      const name = res.instanceId ? instances.find(i => i.id === res.instanceId)?.name : null;
      showToast(`${name ? name + " " : ""}截图已保存`, "success");
      window.dispatchEvent(new CustomEvent("asumigal-screenshots-changed", { detail: { instanceId: res.instanceId } }));
    } catch (error) {
      console.error("全局截屏异常:", error);
      showToast(`${error}`, "error");
    }
  };

  // 注册/更新全局截屏快捷键（shortcutRev 用于设置页退出录制态后强制重注册）
  const globalCaptureRef = useRef(handleGlobalCapture);
  globalCaptureRef.current = handleGlobalCapture;
  const [shortcutRev, setShortcutRev] = useState(0);
  useEffect(() => {
    const onRe = () => setShortcutRev(v => v + 1);
    window.addEventListener("asumigal-shortcut-reregister", onRe);
    return () => window.removeEventListener("asumigal-shortcut-reregister", onRe);
  }, []);
  useEffect(() => {
    const acc = (config.screenshotShortcut || "cmd+alt+s").trim();
    if (!acc) return;
    let cancelled = false;
    (async () => {
      try {
        await unregisterAll();
        if (cancelled) return;
        await register(acc, (event) => {
          if (event.state === "Pressed") globalCaptureRef.current();
        });
      } catch (error) {
        if (!cancelled) {
          console.error("快捷键注册失败:", error);
          showToast(`截图快捷键注册失败: ${error}`, "error");
        }
      }
    })();
    return () => {
      cancelled = true;
      unregisterAll().catch(() => {});
    };
  }, [config.screenshotShortcut, shortcutRev]);

  // ===== 外部命令行调用（CLI）=====
  // 冷启动：从后端取待处理命令；热启动：监听二次调用转发来的事件
  const [cliPending, setCliPending] = useState<{ action: string; target?: string } | null>(null);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    BackendService.takeCliCommand()
      .then(cmd => { if (cmd) setCliPending(cmd); })
      .catch(() => {});
    listen<{ action: string; target?: string }>("cli-command", (e) => {
      setCliPending(e.payload);
    }).then(un => { unlisten = un; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  useEffect(() => {
    if (!cliPending) return;
    if (cliPending.action === "screenshot") {
      setCliPending(null);
      globalCaptureRef.current();
      return;
    }
    if (cliPending.action === "launch" && cliPending.target) {
      const t = cliPending.target;
      const inst = instances.find(i => i.id === t)
        || instances.find(i => i.name === t)
        || instances.find(i => i.name.includes(t));
      if (inst) {
        setCliPending(null);
        handleLaunchRef.current(inst);
      } else if (instances.length > 0) {
        setCliPending(null);
        showToast(`未找到实例：${t}`, "error");
      }
      // 实例列表尚未加载完成时保留 pending，待 instances 就绪后再处理
    }
  }, [cliPending, instances]);

  const handleStop = async (instance: GameInstance) => {
    try {
      const bottlePath = instance.runMode === 'parallels'
        ? `${config.pdPath}/${instance.bottleName}`
        : instance.runMode === 'direct'
          ? instance.bottleName
          : `${config.bottlesPath}/${instance.bottleName}`;
      const killedPids = await BackendService.stopGame(instance.id, {
        bottle_path: bottlePath,
        game_exe: instance.executablePath,
        crossover_app_path: config.crossoverPath,
        run_mode: instance.runMode || 'crossover',
        command_args: instance.commandArgs || '',
        env_vars: instance.envVars || '',
        work_dir: instance.workDir || ''
      });

      const pidsText = Array.isArray(killedPids) && killedPids.length > 0
        ? `: ${killedPids.join(", ")}`
        : "";
      showToast(`${instance.name} 已发送终止指令${pidsText}`, "success");
    } catch (error) {
      console.error("停止异常:", error);
      showToast(`${error}`, "error");
    }
  };

  const currentDisplayInstance = activeInstance || (instances.length > 0 ? instances[0] : undefined);

  return (
    <Layout 
      activeTab={activeTab} 
      setActiveTab={setActiveTab}
      currentInstance={currentDisplayInstance} 
      bgImage="https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=2568&auto=format&fit=crop"
      onRefresh={() => loadInstancesData(true)} 
      bottomAction={
        <LaunchControl 
          instances={instances} 
          selectedId={currentDisplayInstance?.id}
          onSelectInstance={setActiveInstanceId}
          onLaunch={handleLaunch} 
          onGoToSettings={(instance) => {
            setInstanceSettingsTargetId(instance.id);
            setInstanceSettingsTargetTab("overview");
            setFocusInstanceId(instance.id);
            setActiveTab("instances");
          }}
          onStop={handleStop}
          dryRunActive={dryRunActive}
          dryRunInstanceId={dryRunInstanceId}
          onToggleDryRun={handleToggleDryRun}
        />
      }
    >
      {/* Home 页内容 */}
      {activeTab === "home" && (config.showHomeGreeting ?? true) && (
        <div className="max-w-xl mt-20 px-10 animate-in slide-in-from-left-8 fade-in duration-500">
          <h3 className={`text-3xl font-bold mb-2.5 tracking-tight ${isDark ? "text-white drop-shadow-md" : "text-slate-900 drop-shadow-[0_1px_8px_rgba(255,255,255,0.85)]"}`}>
            {config.greetingTitle ?? "Ciallo~ (∠・ω< )⌒★"}
          </h3>
          <p className={`text-base leading-relaxed max-w-md ${isDark ? "text-white/80 drop-shadow" : "text-slate-800 font-medium drop-shadow-[0_1px_6px_rgba(255,255,255,0.8)]"}`}>
            {config.greetingSubtitle ?? "欢迎回来，先輩"}
          </p>
        </div>
      )}

      {/* 实例管理页 */}
      {activeTab === "instances" && (
        <InstancesPage 
          instances={instances} 
          setInstances={handleUpdateInstances} 
          onLaunch={handleLaunch} 
          settingsTargetId={instanceSettingsTargetId}
          settingsTargetTab={instanceSettingsTargetTab}
          onConsumeSettingsTarget={() => {
            setInstanceSettingsTargetId(null);
            setInstanceSettingsTargetTab(null);
          }}
          focusInstanceId={focusInstanceId}
          onConsumeFocusInstance={() => setFocusInstanceId(null)}
          onActiveInstanceIdChange={setActiveInstanceId}
        />
      )}

      {/* 发现页 */}
      {activeTab === 'discovery' && <DiscoveryPage />}
      
      {/* 设置页 */}
      {activeTab === "settings" && (
        <SettingsPage />
      )}

    </Layout>
  );
}

function App() {
  return (
    // --- 2. 关键修复：必须包裹 ThemeProvider，否则 useTheme 会报错导致白屏 ---
    <ThemeProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
