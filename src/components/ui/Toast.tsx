import React, { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { cn } from '../utils/cn';

export interface Toast {
  id: string;
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
}

interface ToastProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

export const ToastItem: React.FC<ToastProps> = ({ toast, onRemove }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    // Trigger slide-in animation
    setTimeout(() => setIsVisible(true), 10);

    // Auto-remove after duration
    const timer = setTimeout(() => {
      handleRemove();
    }, toast.duration || 4000);

    return () => clearTimeout(timer);
  }, []);

  const handleRemove = () => {
    setIsRemoving(true);
    setTimeout(() => {
      onRemove(toast.id);
    }, 300); // Match animation duration
  };

  const typeStyles = {
    success: 'bg-gradient-to-r from-green-500 to-emerald-500 border-green-400',
    error: 'bg-gradient-to-r from-red-500 to-rose-500 border-red-400',
    info: 'bg-gradient-to-r from-blue-500 to-cyan-500 border-blue-400',
  };

  const iconColors = {
    success: 'text-white',
    error: 'text-white',
    info: 'text-white',
  };

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg shadow-2xl border-2 backdrop-blur-sm',
        'transform transition-all duration-300 ease-out',
        isVisible && !isRemoving
          ? 'translate-x-0 opacity-100 scale-100'
          : 'translate-x-full opacity-0 scale-95',
        typeStyles[toast.type || 'success'],
        toast.type === 'error' ? 'sm:min-w-[320px] sm:max-w-[520px] sm:w-auto' : 'sm:min-w-[320px] sm:max-w-[420px] sm:w-auto'
      )}
      style={{
        minWidth: '280px',
        maxWidth: 'calc(100vw - 1.5rem)',
        width: '100%',
      }}
    >
      {/* Animated background line */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-white/30">
        <div
          className="h-full bg-white/60 animate-progress"
          style={{
            animation: `shimmer 2s ease-in-out infinite`,
          }}
        />
      </div>

      <div className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4 pr-2 sm:pr-3">
        {/* Icon */}
        <div className="flex-shrink-0">
          <div className="relative">
            <div className="absolute inset-0 bg-white/20 rounded-full blur-sm animate-pulse" />
            <CheckCircle2
              className={cn('w-5 h-5 sm:w-6 sm:h-6 relative z-10', iconColors[toast.type || 'success'])}
            />
          </div>
        </div>

        {/* Message */}
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-xs sm:text-sm leading-snug break-words whitespace-pre-line">
            {toast.message}
          </p>
        </div>

        {/* Close button */}
        <button
          onClick={handleRemove}
          className="flex-shrink-0 p-1 rounded-full hover:bg-white/20 active:bg-white/30 transition-colors group touch-manipulation"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white group-hover:scale-110 transition-transform" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/20">
        <div
          className="h-full bg-white/60 animate-shrink"
          style={{
            animation: `shrink ${toast.duration || 4000}ms linear forwards`,
          }}
        />
      </div>

      <style>{`
        @keyframes shimmer {
          0%, 100% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
        }
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
        .animate-progress {
          animation: shimmer 2s ease-in-out infinite;
        }
        .animate-shrink {
          animation: shrink ${toast.duration || 4000}ms linear forwards;
        }
      `}</style>
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-3 right-3 sm:top-4 sm:right-4 left-3 sm:left-auto z-[9999] flex flex-col gap-2 sm:gap-3 pointer-events-none max-w-[calc(100vw-1.5rem)] sm:max-w-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto w-full sm:w-auto">
          <ToastItem toast={toast} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
};

