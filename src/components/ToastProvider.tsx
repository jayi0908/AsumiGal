import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { clsx } from "clsx";

// 定义通知类型
export type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// 供组件使用的 Hook
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context;
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type }]);

    // 3秒后自动消失
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* Toast 容器：固定在右上角 */}
      <div className="fixed top-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// 单个 Toast 组件
function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const icons = {
    success: <CheckCircle2 size={16} className="text-emerald-400" />,
    error: <AlertCircle size={16} className="text-rose-400" />,
    info: <Info size={16} className="text-indigo-400" />,
  };

  const bgStyles = {
    success: "bg-emerald-500/15 border-emerald-500/25",
    error: "bg-rose-500/15 border-rose-500/25",
    info: "bg-indigo-500/15 border-indigo-500/25",
  };

  return (
    <motion.div
      layout
      initial={{ x: 80, opacity: 0, scale: 0.94 }}
      animate={{ x: 0, opacity: 1, scale: 1 }}
      exit={{ x: 80, opacity: 0, scale: 0.94 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={clsx(
        "pointer-events-auto flex items-center gap-3 px-3.5 py-2.5 rounded-xl backdrop-blur-xl shadow-xl min-w-[260px] max-w-sm",
        "bg-[#181b24]/95 text-slate-100"
      )}
    >
      {/* 左侧图标 */}
      <div className={clsx("p-1.5 rounded-lg border", bgStyles[toast.type])}>
          {icons[toast.type]}
      </div>

      {/* 消息文本 */}
      <div className="flex-1 text-xs font-medium leading-snug text-slate-100">
        {toast.message}
      </div>

      {/* 关闭按钮 */}
      <button onClick={onClose} className="p-1 text-slate-400 hover:text-white transition-colors">
        <X size={14} />
      </button>
    </motion.div>
  );
}