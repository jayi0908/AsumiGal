import { useState, useEffect } from "react";
import { useTheme, ThemeMode } from "../contexts/ThemeContext";
import { Monitor, Sun, Moon, Type, Image as ImageIcon, FolderOpen, Layout, Cog, Info, Github, Sliders, Search } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { clsx } from "clsx";

type SettingTab = "general" | "global" | "appearance" | "about";

export function SettingsPage() {
  const { config, updateConfig, currentTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<SettingTab>("global");
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [bottles, setBottles] = useState<string[]>([]);
  const [pdVms, setPdVms] = useState<string[]>([]);

  // 加载系统字体
  useEffect(() => {
    const loadFonts = async () => {
      try {
        const fonts = await invoke<string[]>("get_system_fonts");
        setSystemFonts(["system-ui", ...fonts]); // 把默认选项加在最前面
      } catch (e) {
        console.error("字体加载失败", e);
        // 失败兜底
        setSystemFonts(["system-ui", "Arial", "PingFang SC"]);
      }
    };
    loadFonts();
  }, []);

  useEffect(() => {
    const loadContainers = async () => {
      try {
        const resBottles = await invoke<string[]>("get_crossover_bottles", { path: config.bottlesPath });
        const validBottles = resBottles.length > 0 ? resBottles : ["Default"];
        setBottles(validBottles);
        if (!validBottles.includes(config.defaultBottle)) {
          updateConfig({ defaultBottle: validBottles[0] });
        }
      } catch (e) { setBottles(["Default"]); }

      try {
        const resVms = await invoke<string[]>("get_pd_vms", { path: config.pdPath });
        setPdVms(resVms.length > 0 ? resVms : [""]);
      } catch (e) { setPdVms([""]); }
    };
    loadContainers();
  }, [config.bottlesPath, config.pdPath]);

  const getHomePath = async () => {
    try {
      return await invoke<string>("get_home_dir");
    } catch (e) { return undefined; }
  };

  const handleSelectBg = async () => {
    try {
      const home = await getHomePath();
      const selected = await open({
        multiple: false, directory: false, defaultPath: home,
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }]
      });
      if (selected && typeof selected === "string") updateConfig({ customBgImage: convertFileSrc(selected) });
    } catch (e) { console.error(e); }
  };

  const getBgSrc = (src: string) => {
    if (!src) return '';
    // 如果已经是 http 或 tauri asset 协议，直接返回
    if (src.startsWith('http') || src.startsWith('asset://') || src.startsWith('data:')) return src;
    // 如果用户手动粘贴了绝对路径 /Users/... ，在此处实时转换
    return convertFileSrc(src);
  };

  const handleSelectFolder = async (key: 'crossoverPath' | 'bottlesPath' | 'pdPath' | 'defaultDiskGameRoot' | 'defaultLocalGameRoot') => {
     try {
      const home = await getHomePath();
      const defaultPath = key === 'crossoverPath' ? '/Applications' : home;
      const selected = await open({
        multiple: false, directory: true, defaultPath: defaultPath,
      });
      if (selected) updateConfig({ [key]: selected as string });
    } catch (e) { console.error(e); }
  };

  // --- 样式定义 ---
  const isDark = currentTheme === 'dark';
  const cardClass = clsx(
    "border rounded-xl p-6 space-y-4 transition-all backdrop-blur-md",
    isDark ? "bg-black/40 border-white/5 shadow-inner" : "bg-white/70 border-black/5 shadow-sm"
  );
  const headingClass = clsx("text-3xl font-bold mb-6", isDark ? "text-white" : "text-gray-900");
  const subHeadingClass = clsx("font-semibold text-lg flex items-center gap-2", isDark ? "text-white/90" : "text-gray-800");
  const inputClass = clsx(
    "w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors border appearance-none",
    isDark
      ? "bg-black/50 border-white/10 text-white focus:border-indigo-500 placeholder:text-white/20"
      : "bg-white border-gray-200 text-gray-900 focus:border-indigo-500 placeholder:text-gray-400"
  );
  const labelClass = clsx("text-sm font-medium", isDark ? "text-white/60" : "text-gray-600");

  return (
    <div className="flex h-full w-full pt-20 px-8 gap-8 animate-in fade-in zoom-in duration-300">
      
      {/* 左侧导航 */}
      <div className="w-48 flex-shrink-0 flex flex-col gap-2">
        <h2 className={clsx("text-xl font-bold mb-4 px-2", isDark ? "text-white" : "text-gray-800")}>
          设置
        </h2>
        <SidebarItem active={activeTab === 'general'} icon={<Sliders size={18}/>} label="通用" onClick={() => setActiveTab('general')} isDark={isDark} />
        <SidebarItem active={activeTab === 'global'} icon={<Cog size={18}/>} label="全局游戏设置" onClick={() => setActiveTab('global')} isDark={isDark} />
        <SidebarItem active={activeTab === 'appearance'} icon={<Layout size={18}/>} label="外观" onClick={() => setActiveTab('appearance')} isDark={isDark} />
        <SidebarItem active={activeTab === 'about'} icon={<Info size={18}/>} label="关于" onClick={() => setActiveTab('about')} isDark={isDark} />
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 h-full overflow-y-auto custom-scrollbar pb-20 pr-4">

        {/* 通用设置 */}
        {activeTab === 'general' && (
           <div className="space-y-6 max-w-3xl">
             <h1 className={headingClass}>通用</h1>
             <div className={cardClass}>
                <h3 className={subHeadingClass}><Search size={20} /> 搜索/发现</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={clsx("font-medium", isDark ? "text-white" : "text-gray-900")}>
                        {config.enableDiscovery ? "模式: 发现页" : "模式: 搜索框"}
                      </div>
                      <div className={clsx("text-sm mt-1", isDark ? "text-white/50" : "text-gray-500")}>
                        {config.enableDiscovery 
                            ? "导航栏显示「发现」按钮，点击查看推荐文章。" 
                            : "导航栏显示「搜索」按钮，点击弹出搜索框。"}
                        <br/>
                        <span className="opacity-70">通过 Command+S 可唤起搜索</span>
                      </div>
                    </div>
                        
                    {/* 开关 */}
                    <button 
                      onClick={() => updateConfig({ enableDiscovery: !config.enableDiscovery })}
                      className={clsx(
                        "w-12 h-6 rounded-full transition-colors relative flex-shrink-0", 
                        config.enableDiscovery ? "bg-indigo-600" : (isDark ? "bg-gray-700" : "bg-gray-300")
                      )}
                    >
                      <div className={clsx(
                        "w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm", 
                        config.enableDiscovery ? "left-7" : "left-1"
                      )} />
                    </button>
                  </div>
                </div>
             </div>
           </div>
        )}
        
        {/* 全局设置 */}
        {activeTab === 'global' && (
          <div className="space-y-6 max-w-3xl">
            <h1 className={headingClass}>全局游戏设置</h1>
            <div className={cardClass}>
              <h3 className={subHeadingClass}>路径配置</h3>
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className={labelClass}>CrossOver 应用程序路径</label>
                  <div className="flex gap-2">
                    <input type="text" value={config.crossoverPath} onChange={(e) => updateConfig({ crossoverPath: e.target.value })} className={inputClass} />
                    <button onClick={() => handleSelectFolder('crossoverPath')} className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500"><FolderOpen size={18} /></button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className={labelClass}>容器库路径 (Bottles)</label>
                  <div className="flex gap-2">
                    <input type="text" value={config.bottlesPath} onChange={(e) => updateConfig({ bottlesPath: e.target.value })} className={inputClass} />
                    <button onClick={() => handleSelectFolder('bottlesPath')} className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500"><FolderOpen size={18} /></button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className={labelClass}>PD 虚拟机本地路径</label>
                  <div className="flex gap-2">
                    <input type="text" value={config.pdPath} onChange={(e) => updateConfig({ pdPath: e.target.value })} className={inputClass} />
                    <button onClick={() => handleSelectFolder('pdPath')} className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500"><FolderOpen size={18} /></button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className={labelClass}>默认硬盘游戏根目录</label>
                  <div className="flex gap-2">
                    <input type="text" value={config.defaultDiskGameRoot} onChange={(e) => updateConfig({ defaultDiskGameRoot: e.target.value })} className={inputClass} />
                    <button onClick={() => handleSelectFolder('defaultDiskGameRoot')} className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500"><FolderOpen size={18} /></button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className={labelClass}>默认本机游戏根目录</label>
                  <div className="flex gap-2">
                    <input type="text" value={config.defaultLocalGameRoot} onChange={(e) => updateConfig({ defaultLocalGameRoot: e.target.value })} className={inputClass} />
                    <button onClick={() => handleSelectFolder('defaultLocalGameRoot')} className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500"><FolderOpen size={18} /></button>
                  </div>
                </div>
              </div>
            </div>
            {/* 默认游戏容器设置 */}
            <div className={cardClass}>
              <h2 className={subHeadingClass}><FolderOpen size={20} /> 默认运行容器</h2>
              <div className="space-y-4 mt-2">
                <div className="flex flex-col gap-1">
                  <span className={labelClass}>CrossOver 全局默认容器</span>
                  <div className="relative">
                      <select 
                        value={bottles.includes(config.defaultBottle || 'Default') ? (config.defaultBottle || 'Default') : (bottles[0] || 'Default')}
                        onChange={(e) => updateConfig({ defaultBottle: e.target.value })}
                        className={inputClass}
                      >
                        {config.defaultBottle && !bottles.includes(config.defaultBottle) && (
                            <option value={config.defaultBottle}>{config.defaultBottle} (当前)</option>
                        )}
                        {bottles.map(b => (
                            <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                      {/* 自定义下拉箭头图标 */}
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                  </div>
                  <span className="text-xs text-gray-500 mt-1 dark:text-gray-400">导入游戏或新建实例时，将会默认分配到此容器</span>
                </div>
              </div>

              <div className="space-y-4 mt-2">
                <div className="flex flex-col gap-1">
                  <span className={labelClass}>Parallels Desktop 全局默认虚拟机 (Applications)</span>
                  <div className="relative">
                      <select 
                        value={pdVms.includes(config.defaultPdVm || '') ? (config.defaultPdVm || '') : (pdVms[0] || '')}
                        onChange={(e) => updateConfig({ defaultPdVm: e.target.value })}
                        className={inputClass}
                      >
                        {config.defaultPdVm && !pdVms.includes(config.defaultPdVm) && (
                            <option value={config.defaultPdVm}>{config.defaultPdVm} (当前)</option>
                        )}
                        {pdVms.map(vm => (
                            <option key={vm} value={vm}>{vm}</option>
                        ))}
                      </select>
                      {/* 自定义下拉箭头图标 */}
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                  </div>
                  <span className="text-xs text-gray-500 mt-1 dark:text-gray-400">导入游戏或新建实例时，将会默认分配到此虚拟机 APP，要确定目标虚拟机的 id 可将访达中 PD 虚拟机本地路径下的 Applications 文件夹拖到终端中</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 外观设置 */}
        {activeTab === 'appearance' && (
          <div className="space-y-6 max-w-3xl">
            <h1 className={headingClass}>外观</h1>

            {/* 颜色模式 */}
            <div className={cardClass}>
              <h2 className={subHeadingClass}><Monitor size={20} /> 颜色模式</h2>
              <div className={clsx("rounded-xl p-1 flex mt-2 border", currentTheme === 'dark' ? "bg-black/30 border-white/5" : "bg-gray-100 border-gray-200")}>
                {['system', 'light', 'dark'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => updateConfig({ theme: mode as ThemeMode })}
                    className={clsx(
                      "flex-1 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2",
                      config.theme === mode 
                        ? "bg-indigo-600 text-white shadow-md" 
                        : (currentTheme === 'dark' ? "text-white/60 hover:text-white" : "text-gray-500 hover:text-gray-900")
                    )}
                  >
                    {mode === 'system' && <Monitor size={16} />}
                    {mode === 'light' && <Sun size={16} />}
                    {mode === 'dark' && <Moon size={16} />}
                    {mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色'}
                  </button>
                ))}
              </div>
            </div>

            {/* 字体设置 */}
            <div className={cardClass}>
              <h2 className={subHeadingClass}><Type size={20} /> 字体设置</h2>
              <div className="space-y-4 mt-2">
                <div className="flex flex-col gap-1">
                  <span className={labelClass}>界面字体</span>
                  <div className="relative">
                      <select 
                        value={config.fontFamily}
                        onChange={(e) => updateConfig({ fontFamily: e.target.value })}
                        className={inputClass}
                      >
                        {systemFonts.map(f => (
                            <option key={f} value={f === 'system-ui' ? 'system-ui' : f}>
                                {f === 'system-ui' ? '系统默认' : f}
                            </option>
                        ))}
                      </select>
                      {/* 加上一个自定义的下拉箭头图标 */}
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className={labelClass}>字体大小缩放</span>
                    <span className={clsx("font-mono", currentTheme === 'dark' ? "text-white/50" : "text-gray-500")}>
                        {Math.round(config.fontSize * 100)}%
                    </span>
                  </div>
                  <input 
                    type="range" min="0.8" max="1.2" step="0.05"
                    value={config.fontSize}
                    onChange={(e) => updateConfig({ fontSize: parseFloat(e.target.value) })}
                    className="w-full accent-indigo-500 h-1 bg-gray-500/30 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className={clsx("flex justify-between text-xs px-1", currentTheme === 'dark' ? "text-white/40" : "text-gray-400")}>
                      <span>小</span><span>标准</span><span>大</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 背景图像 */}
            <div className={cardClass}>
              <h2 className={subHeadingClass}><ImageIcon size={20} /> 背景图像</h2>
              <div className="flex items-center justify-between mt-2">
                <span className={labelClass}>优先使用实例背景</span>
                <button 
                  onClick={() => updateConfig({ useInstanceBg: !config.useInstanceBg })}
                  className={clsx("w-12 h-6 rounded-full transition-colors relative", config.useInstanceBg ? "bg-indigo-600" : "bg-gray-400/30")}
                >
                  <div className={clsx("w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm", config.useInstanceBg ? "left-7" : "left-1")} />
                </button>
              </div>
              <div className="space-y-2 pt-2">
                <span className={clsx("text-xs", currentTheme === 'dark' ? "text-white/40" : "text-gray-400")}>全局默认背景</span>
                <div className="flex gap-2">
                  <input type="text" value={config.customBgImage || ''} onChange={(e) => updateConfig({ customBgImage: e.target.value })} placeholder="https://... 或 本地绝对路径" className={inputClass} />
                  <button onClick={handleSelectBg} className="p-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-500"><FolderOpen size={18} /></button>
                </div>
                {config.customBgImage && (
                  <div className="mt-2 h-32 w-full rounded-lg overflow-hidden border border-white/10 relative group bg-black/50">
                     {/* 废弃错误的 file://，改用 getBgSrc() */}
                     <img src={getBgSrc(config.customBgImage)} className="w-full h-full object-cover" />
                     <button onClick={() => updateConfig({ customBgImage: "" })} className="absolute top-2 right-2 bg-black/60 hover:bg-red-500 p-1 px-3 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-all backdrop-blur">清除</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 关于 */}
        {activeTab === 'about' && (
          <div className="space-y-6 max-w-3xl">
            <h1 className={headingClass}>关于</h1>
            
            <div className={cardClass}>
              <div className="flex items-start gap-6">
                <img 
                    src="/app-icon.png" 
                    alt="AsumiGal Logo" 
                    className="w-20 h-20 rounded-[1.2rem] shadow-xl shadow-indigo-500/20 object-cover"
                />
                
                <div className="flex-1 space-y-2">
                   <div>
                     <h2 className={clsx("text-4xl font-bold tracking-tight", isDark ? "text-white" : "text-gray-900")}>AsumiGal</h2>
                     <p className={clsx("text-sm mt-1", isDark ? "text-white/50" : "text-gray-500")}>
                       Version 0.5.0
                     </p>
                   </div>
                   
                   <p className={clsx("leading-relaxed", isDark ? "text-white/80" : "text-gray-700")}>
                     AsumiGal 是一款专为 macOS 设计的 galgame/视觉小说管理器，主要管理通过 CrossOver 与 Parallels Desktop 运行的游戏实例，并兼容原生 macOS APP，旨在补全 galgame 管理器在 macOS 平台的空白。
                   </p>

                   <div className="pt-4 flex gap-3">
                      <button 
                        onClick={async () => {
                          // 使用 Shell 插件打开链接
                          await openUrl("https://github.com/jayi0908/AsumiGal");
                        }}
                        className={clsx(
                          "flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-medium",
                          isDark ? "bg-white/10 hover:bg-white/20 text-white" : "bg-gray-100 hover:bg-gray-200 text-gray-900"
                        )}
                      >
                        <Github size={18} />
                        GitHub 仓库
                      </button>
                   </div>
                </div>
              </div>
            </div>

            {/* 致谢或其他信息 */}
            <div className={cardClass}>
               <h3 className={subHeadingClass}>技术栈</h3>
               <ul className={clsx("space-y-2 text-sm", isDark ? "text-white/70" : "text-gray-600")}>
                  <li>• Tauri - 构建跨平台应用的框架</li>
                  <li>• React & TailwindCSS - 构建现代化的 UI 界面</li>
                  <li>• CrossOver / Wine - 强大的 Windows 兼容层</li>
               </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarItem({ active, icon, label, onClick, isDark }: { active: boolean, icon: any, label: string, onClick: () => void, isDark: boolean }) {
    return (
        <button
          onClick={onClick}
          className={clsx(
            "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all text-sm w-full text-left",
            active 
              ? (isDark 
                  ? "bg-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.1)]" // 深色选中：微发光
                  : "bg-white text-indigo-600 shadow-md ring-1 ring-black/5"       // 浅色选中：纯白卡片+蓝字
                )
              : (isDark 
                  ? "text-white/50 hover:text-white hover:bg-white/5" 
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"
                )
          )}
        >
          {icon}
          {label}
        </button>
    )
}
