import React from 'react';
import { Card } from '../ui/Card';

function Bone({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-gray-200 ${className ?? ''}`} />;
}

export const FinanceReportsSkeleton: React.FC = () => (
  <div className="space-y-6">
    <div className="space-y-2">
      <Bone className="h-8 w-56" />
      <Bone className="h-4 w-full max-w-xl" />
    </div>
    <Card>
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Bone key={i} className="h-10 w-40" />
        ))}
      </div>
    </Card>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <Bone className="mb-2 h-4 w-32" />
          <Bone className="h-8 w-24" />
        </Card>
      ))}
    </div>
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <Bone className="mb-4 h-5 w-40" />
          <Bone className="h-56 w-full" />
        </Card>
      ))}
    </div>
    <Card>
      <Bone className="mb-4 h-10 w-full" />
      {Array.from({ length: 8 }).map((_, i) => (
        <Bone key={i} className="mb-2 h-10 w-full" />
      ))}
    </Card>
  </div>
);
