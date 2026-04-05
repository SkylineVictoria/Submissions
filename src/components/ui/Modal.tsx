import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../utils/cn';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'md' }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  /* Full-bleed on small viewports; capped width on sm+ so laptop/desktop dialogs are not edge-to-edge. */
  const sizeClasses = {
    sm: 'w-full max-w-[100vw] sm:max-w-md',
    md: 'w-full max-w-[100vw] sm:max-w-xl',
    lg: 'w-full max-w-[100vw] sm:max-w-3xl',
    xl: 'w-full max-w-[100vw] sm:max-w-5xl',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-white/10 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          'bg-white shadow-2xl flex max-h-[min(92dvh,100%)] min-w-0 flex-col rounded-t-xl sm:max-h-[90vh] sm:rounded-xl',
          sizeClasses[size]
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 shrink-0 px-4 py-3 border-b border-[var(--border)] sm:px-5 sm:py-4">
          <h2 className="min-w-0 text-base font-bold text-[var(--text)] sm:text-lg pr-2">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content - scrollable */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-5 sm:py-5">
          {children}
        </div>
      </div>
    </div>
  );
};

