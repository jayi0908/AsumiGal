// src/components/SearchModal.tsx
import { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, ExternalLink } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { motion, AnimatePresence } from 'framer-motion';
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { BackendService } from '../services/backend';
import { SearchResult } from '../types/instance';
import clsx from 'clsx';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === 'dark';
  
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]); // 存储搜索结果
  const [loadingSource, setLoadingSource] = useState<"touchgal" | "vndb" | null>(null);
  const [hasSearched, setHasSearched] = useState(false); // 是否执行过搜索
  const inputRef = useRef<HTMLInputElement>(null);

  // 状态重置
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      // 关闭时清空状态
      setSearchQuery('');
      setResults([]);
      setHasSearched(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSearch = async (source: "touchgal" | "vndb") => {
    if (!searchQuery.trim()) return;
    
    setLoadingSource(source);
    setResults([]); // 清空旧结果
    setHasSearched(true);
    
    try {
      console.log(`[Search] Invoking backend for ${source}...`);
      const data = await BackendService.searchGame(searchQuery, source);
      console.log("Results:", data);
      setResults(data);
    } catch (error) {
      console.error("Search failed:", error);
    } finally {
      setLoadingSource(null);
    }
  };

  const handleOpenResult = async (url: string) => {
      try {
          await openUrl(url);
      } catch (e) {
          window.open(url, '_blank');
      }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-start pt-[15vh] justify-center" onClick={onClose}>
            {/* 遮罩 */}
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />

            {/* 弹窗主体 */}
            <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: -20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -20 }}
                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                className={clsx(
                    "relative w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden z-10 flex flex-col max-h-[70vh]", 
                    isDark ? "bg-[#1e1e2e] border border-white/10" : "bg-white"
                )}
                onClick={e => e.stopPropagation()} 
            >
                {/* 1. 顶部输入栏 */}
                <div className="relative border-b border-gray-200 dark:border-white/5 p-4 flex-shrink-0 z-20 bg-inherit">
                    <Search className={clsx("absolute left-8 top-1/2 -translate-y-1/2", isDark ? "text-white/40" : "text-gray-400")} size={24} />
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="搜索游戏..."
                        className={clsx(
                            "w-full pl-14 pr-12 py-3 text-xl bg-transparent outline-none font-medium",
                            isDark ? "text-white placeholder:text-white/20" : "text-gray-900 placeholder:text-gray-300"
                        )}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch('touchgal')} // 默认回车搜 TouchGal
                    />
                    <button onClick={onClose} className="absolute right-6 top-1/2 -translate-y-1/2 p-2 rounded-lg opacity-50 hover:opacity-100 transition-opacity">
                        <X size={20} className={isDark ? "text-white" : "text-black"} />
                    </button>
                </div>

                {/* 2. 快捷操作区 (始终显示，在底部或结果上方) */}
                <div className="p-3 bg-gray-50/50 dark:bg-white/5 grid grid-cols-2 gap-3 flex-shrink-0 border-b border-white/5">
                    <SearchOption 
                        title="TouchGal" 
                        desc="搜索游戏元数据" 
                        colorClass="text-pink-500" 
                        isLoading={loadingSource === 'touchgal'}
                        onClick={() => handleSearch('touchgal')} 
                        isDark={isDark} 
                    />
                    <SearchOption 
                        title="VNDB" 
                        desc="视觉小说数据库" 
                        colorClass="text-indigo-500" 
                        isLoading={loadingSource === 'vndb'}
                        onClick={() => handleSearch('vndb')} 
                        isDark={isDark} 
                    />
                </div>

                {/* 3. 结果列表区域 (可滚动) */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 min-h-[200px] relative">
                    
                    {/* Loading State */}
                    {loadingSource && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3 bg-inherit bg-opacity-80 z-10">
                             <Loader2 size={32} className="animate-spin text-indigo-500" />
                             <span className={clsx("text-sm", isDark?"text-white/50":"text-gray-500")}>正在从 {loadingSource} 搜索...</span>
                        </div>
                    )}

                    {/* Empty State */}
                    {!loadingSource && hasSearched && results.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-2 opacity-50">
                            <Search size={48} />
                            <span>未找到相关结果</span>
                        </div>
                    )}
                    
                    {/* Init State */}
                    {!hasSearched && !loadingSource && (
                         <div className="flex flex-col items-center justify-center h-full text-center space-y-2 opacity-30">
                            <span className="text-sm">输入关键词并选择数据源开始搜索</span>
                        </div>
                    )}

                    {/* Results Grid */}
                    <div className="grid grid-cols-1 gap-3">
                        {results.map((res) => (
                            <div 
                                key={res.id}
                                onClick={() => handleOpenResult(res.url)}
                                className={clsx(
                                    "flex gap-4 p-3 rounded-xl border transition-all cursor-pointer group hover:shadow-lg",
                                    isDark ? "bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20" : "bg-white border-gray-100 hover:border-indigo-100"
                                )}
                            >
                                {/* 封面图 */}
                                <div className="w-24 h-16 rounded-lg overflow-hidden bg-gray-800 flex-shrink-0 relative">
                                    <img 
                                        src={res.cover} 
                                        alt={res.title} 
                                        referrerPolicy="no-referrer"
                                        className="w-full h-full object-cover transition-transform group-hover:scale-105" 
                                    />
                                    {/* 来源角标 */}
                                    <div className={clsx("absolute bottom-0 right-0 px-1.5 py-0.5 text-[10px] font-bold text-white rounded-tl-md", res.source === 'VNDB' ? "bg-indigo-500" : "bg-pink-500")}>
                                        {res.source}
                                    </div>
                                </div>
                                
                                {/* 信息 */}
                                <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <h3 className={clsx("font-bold text-base truncate group-hover:text-indigo-400 transition-colors", isDark?"text-white":"text-gray-900")}>
                                        {res.title}
                                    </h3>
                                    <div className="flex items-center gap-4 mt-1">
                                        {res.date && (
                                            <span className={clsx("text-xs", isDark?"text-white/40":"text-gray-500")}>
                                                更新: {res.date}
                                            </span>
                                        )}
                                        <span className={clsx("text-xs flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-indigo-500")}>
                                            查看详情 <ExternalLink size={10} />
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className={clsx("px-4 py-2 text-[10px] text-right opacity-40 font-mono flex justify-between border-t border-white/5", isDark ? "text-white" : "text-black")}>
                    <span>Supported by {loadingSource ? loadingSource : "Galgame API"}</span>
                    <span>ESC to close</span>
                </div>
            </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// 保持 SearchOption 不变
function SearchOption({ title, desc, colorClass, onClick, isDark, isLoading }: any) {
    return (
        <button
          onClick={onClick}
          disabled={isLoading}
          className={clsx(
            "flex items-center gap-4 p-3 rounded-xl transition-all text-left group relative overflow-hidden h-full",
            isDark 
               ? "bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10" 
               : "bg-white border border-gray-100 hover:border-indigo-200 hover:shadow-sm"
          )}
        >
            <div className={clsx("p-2 rounded-lg flex-shrink-0 transition-colors", isDark ? "bg-white/5 group-hover:bg-white/10" : "bg-blue-50 group-hover:bg-blue-100")}>
                {isLoading ? (
                    <Loader2 size={18} className={clsx("animate-spin", colorClass)} />
                ) : (
                    <Search size={18} className={colorClass} />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className={clsx("font-bold text-sm", isDark?"text-white":"text-gray-900")}>{title}</div>
                <div className={clsx("text-[10px] mt-0.5 truncate", isDark?"text-white/40":"text-gray-400")}>{desc}</div>
            </div>
        </button>
    )
}