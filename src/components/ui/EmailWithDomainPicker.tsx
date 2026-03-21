import React from 'react';
import { Input } from './Input';
import { STUDENT_DOMAIN, STAFF_DOMAIN } from '../../lib/emailUtils';
import { cn } from '../utils/cn';

type Domain = typeof STUDENT_DOMAIN | typeof STAFF_DOMAIN;

interface EmailWithDomainPickerProps {
  localPart: string;
  onLocalPartChange: (value: string) => void;
  domain: Domain;
  onDomainChange: (domain: Domain) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  inputClassName?: string;
}

export const EmailWithDomainPicker: React.FC<EmailWithDomainPickerProps> = ({
  localPart,
  onLocalPartChange,
  domain,
  onDomainChange,
  placeholder = 'e.g. firstname.lastname',
  label = 'Email',
  className,
  inputClassName,
}) => {
  const domains: { value: Domain; label: string }[] = [
    { value: STUDENT_DOMAIN, label: `@${STUDENT_DOMAIN.slice(1)}` },
    { value: STAFF_DOMAIN, label: `@${STAFF_DOMAIN.slice(1)}` },
  ];

  return (
    <div className={cn('space-y-2', className)}>
      <label className="block text-xs font-medium text-gray-600">{label}</label>
      <Input
        value={localPart}
        onChange={(e) => onLocalPartChange(e.target.value.replace(/\s/g, '').toLowerCase())}
        placeholder={placeholder}
        className={cn('w-full', inputClassName)}
      />
      <div className="flex gap-2">
        {domains.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() => onDomainChange(d.value)}
            className={cn(
              'flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
              'border',
              domain === d.value
                ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]'
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 hover:border-gray-300'
            )}
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
};
