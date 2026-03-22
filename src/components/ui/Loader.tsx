import React from 'react';
import { cn } from '../utils/cn';

interface LoaderProps {
  /** Full-page centered loader */
  fullPage?: boolean;
  /** Size: sm, md, lg */
  size?: 'sm' | 'md' | 'lg';
  /** Optional loading message */
  message?: string;
  /** Variant: spinner (ring) or dots (bouncing) */
  variant?: 'spinner' | 'dots';
  /** Inline for buttons - dots only, horizontal */
  inline?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
};

const dotSizes = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
  lg: 'w-2.5 h-2.5',
};

export const Loader: React.FC<LoaderProps> = ({
  fullPage = false,
  size = 'md',
  message,
  variant = 'dots',
  inline = false,
  className,
}) => {
  const loader = (
    <div
      className={cn(
        'select-none cursor-wait',
        inline ? 'flex flex-row items-center gap-1.5' : 'flex flex-col items-center justify-center gap-4',
        className
      )}
    >
      {variant === 'spinner' ? (
        <div className="relative">
          <div
            className={cn(
              'rounded-full border-2 border-[var(--border)]',
              sizeClasses[size]
            )}
          />
          <div
            className={cn(
              'absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--brand)] animate-spin',
              sizeClasses[size]
            )}
          />
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center',
              sizeClasses[size]
            )}
          >
            <div
              className={cn(
                'rounded-full bg-[var(--brand)] animate-pulse',
                size === 'sm' ? 'w-1.5 h-1.5' : size === 'md' ? 'w-2 h-2' : 'w-2.5 h-2.5'
              )}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                'rounded-full bg-[var(--brand)] loader-dot',
                dotSizes[size]
              )}
            />
          ))}
        </div>
      )}
      {message && !inline && (
        <p className="text-sm font-medium text-[var(--text)] animate-pulse">{message}</p>
      )}
    </div>
  );

  if (fullPage) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center select-none cursor-wait">
        {loader}
      </div>
    );
  }

  return loader;
};
