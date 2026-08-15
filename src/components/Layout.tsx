import { ReactNode, useEffect, useState } from "react";
import { convertFileSrc } from '@tauri-apps/api/core';
import { useTheme } from '../contexts/ThemeContext';
import { GameInstance } from "./InstancesPage";
import { SearchModal } from "./SearchModal";
import HeadNavBar from "./HeadNavBar";
import AdvancedCard from "./AdvancedCard";
import LiquidGlassDistortionFilter from "./LiquidGlassFilter";
import clsx from "clsx";

interface LayoutProps {
  children?: ReactNode;
  bgImage?: string;
  activeTab: "home" | "instances" | "discovery" | "settings";
  setActiveTab: (tab: "home" | "instances" | "discovery" | "settings") => void;
  bottomAction?: ReactNode; 
  onRefresh?: () => void;
  currentInstance?: GameInstance;
}

export function Layout({ 
    children, 
    bgImage, 
    activeTab, 
    setActiveTab, 
    bottomAction, 
    onRefresh, 
    currentInstance 
}: LayoutProps) {
    const { config, currentTheme } = useTheme();
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const resolveImage = (src: string) => {
      if (!src) return '';
      // 如果已经是合法网络协议、Tauri 安全协议，或是 Base64，直接返回
      if (src.startsWith('http') || src.startsWith('asset://') || src.startsWith('data:')) {
        return src;
      }
      // 否则说明是用户手动填写的本地绝对路径，进行转换
      return convertFileSrc(src);
    };

    // 计算背景图
    const getBgImage = () => {
      if (config.useInstanceBg && currentInstance?.backgroundImage) {
          return resolveImage(currentInstance.backgroundImage);
      }
      if (config.customBgImage) {
          return resolveImage(config.customBgImage);
      }
      return resolveImage(bgImage || "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=2568");
    };

    const isDark = currentTheme === 'dark';

    // 快捷键监听
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          setIsSearchOpen(true);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

  return (
    <div className={clsx(
             "relative h-screen w-screen overflow-hidden font-sans transition-colors duration-300",
             isDark ? "text-white" : "text-gray-900"
        )}>
      {/* 液态玻璃 SVG 滤镜 */}
      <LiquidGlassDistortionFilter />

      {/* 背景层 */}
      <div className="absolute inset-0 z-0">
        <img 
          src={getBgImage()} 
          className={`w-full h-full object-cover transition-all duration-500 ${activeTab !== 'home' ? 'opacity-30 blur-sm' : 'opacity-60'}`} 
          alt="bg" 
        />
        <div className={clsx(
            "absolute inset-0 bg-gradient-to-t",
            isDark ? "from-black/90 via-black/40 to-black/20" : "" 
        )} />
        <div className={clsx(
            "absolute inset-0 backdrop-blur-[2px]",
            isDark ? "bg-black/30" : "bg-white/20"
        )} />
      </div>

      {/* 搜索模态框 */}
      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      {/* 内容主体（导航栏 + 液态玻璃内容卡片） */}
      <div className="relative z-10 flex flex-col w-full h-full">
        {/* 顶部导航 */}
        <div className="flex justify-center pt-4 pb-2 shrink-0">
          <HeadNavBar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onRefresh={onRefresh}
            onOpenSearch={() => setIsSearchOpen(true)}
          />
        </div>

        {/* 主内容区域 */}
        <main className="flex-1 min-h-0 px-4 pb-4">
          {activeTab === 'home' ? (
            <div className="w-full h-full relative">
              {children}
            </div>
          ) : (
            <AdvancedCard level="back" className="w-full h-full">
              <div className="w-full h-full overflow-y-auto overflow-x-hidden custom-scrollbar">
                {children}
              </div>
            </AdvancedCard>
          )}
        </main>
      </div>

      {activeTab === 'home' && bottomAction && (
        <div className="absolute inset-x-0 bottom-0 z-20 animate-in slide-in-from-bottom-10 fade-in duration-500">
          {bottomAction}
        </div>
      )}
    </div>
  );
}
