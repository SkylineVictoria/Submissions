import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../utils/cn';

interface TableLayoutOption {
  value: string;
  label: string;
  preview: React.ReactNode;
}

const PREVIEW_STYLE = 'border border-gray-500 px-2 py-1 bg-[#595959] text-white font-semibold';
const PREVIEW_ROW_STYLE = 'border border-gray-500 px-2 py-1 bg-[#595959] text-white';

const TABLE_LAYOUT_OPTIONS: TableLayoutOption[] = [
  {
    value: 'no_image',
    label: 'No image (header 1st | header 2nd | input columns)',
    preview: (
      <table className="border-collapse border border-gray-500 text-xs">
        <thead>
          <tr>
            <th className={PREVIEW_STYLE}>Header 1st</th>
            <th className={PREVIEW_STYLE}>Header 2nd</th>
            <th className={PREVIEW_STYLE}>Input</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={PREVIEW_ROW_STYLE}>Label</td>
            <td className={PREVIEW_ROW_STYLE}>Desc</td>
            <td className="border border-gray-500 px-2 py-1 bg-white">___</td>
          </tr>
        </tbody>
      </table>
    ),
  },
  {
    value: 'default',
    label: 'Image + label in first column',
    preview: (
      <table className="border-collapse border border-gray-500 text-xs">
        <thead>
          <tr>
            <th className={PREVIEW_STYLE}>Shape</th>
            <th className={PREVIEW_STYLE}>Col 1</th>
            <th className={PREVIEW_STYLE}>Col 2</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={PREVIEW_ROW_STYLE}>[img] Label</td>
            <td className="border border-gray-500 px-2 py-1 bg-white">___</td>
            <td className="border border-gray-500 px-2 py-1 bg-white">___</td>
          </tr>
        </tbody>
      </table>
    ),
  },
  {
    value: 'no_image_no_header',
    label: 'No image (no header)',
    preview: (
      <table className="border-collapse border border-gray-500 text-xs">
        <tbody>
          <tr>
            <td className={PREVIEW_ROW_STYLE}>Col 1</td>
            <td className={PREVIEW_ROW_STYLE}>Col 2</td>
            <td className="border border-gray-500 px-2 py-1 bg-white">___</td>
          </tr>
        </tbody>
      </table>
    ),
  },
  {
    value: 'split',
    label: 'Layout 1 (name | image | input columns – for polygon, measurement, etc.)',
    preview: (
      <table className="border-collapse border border-gray-500 text-xs">
        <thead>
          <tr>
            <th className={PREVIEW_STYLE}>Name</th>
            <th className={PREVIEW_STYLE}>Image</th>
            <th className={PREVIEW_STYLE}>Input</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={PREVIEW_ROW_STYLE}>Name</td>
            <td className={PREVIEW_ROW_STYLE}>[img]</td>
            <td className="border border-gray-500 px-2 py-1 bg-white">___</td>
          </tr>
        </tbody>
      </table>
    ),
  },
];

interface TableLayoutSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const TableLayoutSelect: React.FC<TableLayoutSelectProps> = ({ value, onChange, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);
  const selectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const selectedOption = TABLE_LAYOUT_OPTIONS.find((o) => o.value === value);

  const hoveredOption = hoveredValue ? TABLE_LAYOUT_OPTIONS.find((o) => o.value === hoveredValue) : null;

  return (
    <div ref={selectRef} className={cn('relative w-full', className)}>
      {isOpen && hoveredOption && (
        <div className="absolute left-0 bottom-full mb-2 z-[300] p-2 bg-white border border-gray-200 rounded-lg shadow-xl">
          <div className="text-xs font-semibold text-gray-600 mb-1.5">Preview:</div>
          {hoveredOption.preview}
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full min-w-0 h-12 px-4 rounded-lg border transition-all duration-200 text-left flex items-center justify-between gap-2 bg-white',
          'border-[var(--border)] hover:border-gray-300',
          'focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:ring-offset-1 focus:border-[var(--brand)]',
          isOpen && 'border-[var(--brand)] ring-2 ring-[var(--brand)] ring-offset-1'
        )}
      >
        <span className={cn('min-w-0 truncate text-sm', selectedOption ? 'text-gray-900' : 'text-gray-400')}>
          {selectedOption?.label ?? 'Select layout...'}
        </span>
        <ChevronDown className={cn('w-5 h-5 shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div
          className="absolute z-[200] left-0 mt-1 min-w-full bg-white border-2 border-gray-200 rounded-lg shadow-lg py-1 max-h-72 overflow-auto"
          onMouseLeave={() => setHoveredValue(null)}
        >
          {TABLE_LAYOUT_OPTIONS.map((option) => (
            <div
              key={option.value}
              onMouseEnter={() => setHoveredValue(option.value)}
            >
              <button
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full px-4 py-2.5 text-left text-sm transition-colors',
                  'hover:bg-orange-50',
                  value === option.value && 'bg-orange-50 text-[var(--brand)] font-semibold'
                )}
              >
                {option.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
