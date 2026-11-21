import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import clsx from "clsx";

interface DeleteModalProps {
  isOpen: boolean;
  instanceName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteModal({ isOpen, instanceName, onClose, onConfirm }: DeleteModalProps) {
  const { currentTheme } = useTheme();
  const isDark = currentTheme === "dark";

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/* 弹窗主体 */}
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 8 }}
            className={clsx(
              "relative w-full max-w-md border rounded-2xl shadow-2xl overflow-hidden",
              isDark
                ? "bg-[#1a1d26] border-rose-500/25 text-slate-100"
                : "bg-[#f8fafc] border-rose-500/20 text-slate-800"
            )}
          >
            {/* 顶部标题栏 */}
            <div className="flex justify-between items-center px-5 py-3.5 border-b border-slate-500/10 bg-rose-500/10">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <AlertTriangle className="text-rose-500" size={18} />
                移除游戏实例
              </h3>
              <button onClick={onClose} className="opacity-50 hover:opacity-100 transition-opacity">
                <X size={18} />
              </button>
            </div>

            {/* 内容区 */}
            <div className="p-5 space-y-2">
              <div className="text-sm leading-relaxed">
                确定要移除实例 <span className="font-semibold text-rose-500">「{instanceName}」</span> 吗？
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                仅移除启动器内的记录与配置，不会删除磁盘上的游戏原文件或截图。
              </p>
            </div>

            {/* 按钮区 */}
            <div className={clsx(
              "px-5 py-3.5 flex justify-end gap-2.5 border-t border-slate-500/10",
              isDark ? "bg-black/20" : "bg-slate-100/70"
            )}>
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-slate-500/10 transition-colors"
              >
                取消
              </button>
              <button
                onClick={onConfirm}
                className="px-5 py-1.5 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-all"
              >
                确认移除
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}