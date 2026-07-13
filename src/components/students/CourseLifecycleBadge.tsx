/**
 * Reusable course lifecycle status capsule (admin + student).
 */
import React from 'react';
import {
  courseLifecycleBadgeClass,
  courseLifecycleLabel,
  type CourseLifecycleStatus,
} from '../../lib/courseLifecycle';
import { cn } from '../utils/cn';

type Props = {
  status: CourseLifecycleStatus | string | null | undefined;
  className?: string;
};

export const CourseLifecycleBadge: React.FC<Props> = ({ status, className }) => {
  const label = courseLifecycleLabel(status);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-tight whitespace-nowrap',
        courseLifecycleBadgeClass(status),
        className,
      )}
      title={label}
    >
      {label}
    </span>
  );
};
