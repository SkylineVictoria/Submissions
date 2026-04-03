import React, { useState, useRef, useLayoutEffect, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
            <th className={PREVIEW_STYLE}>Img</th>
            <th className={PREVIEW_STYLE}>Input</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={PREVIEW_ROW_STYLE}>A</td>
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

const PREVIEW_W = 320;
const PREVIEW_GAP = 8;

export const TableLayoutSelect: React.FC<TableLayoutSelectProps> = ({ value, onChange, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);
  const selectRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<{
    top: number;
    left: number;
    minWidth: number;
    maxWidth: number;
    maxHeight: number;
  } | null>(null);
  const [previewStyle, setPreviewStyle] = useState<{ top: number; left: number } | null>(null);

  const updateDropdownPosition = useCallback(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
    const margin = 8;
    const gap = 4;
    const spaceBelow = Math.max(0, viewportH - rect.bottom - margin);
    const spaceAbove = Math.max(0, rect.top - margin);
    const openDown = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    const available = openDown ? spaceBelow - gap : spaceAbove - gap;
    const maxHeight = Math.min(288, Math.max(120, available));
    const top = openDown
      ? rect.bottom + gap
      : Math.max(margin, rect.top - maxHeight - gap);
    let left = rect.left;
    const minWidth = Math.max(rect.width, 280);
    if (left + minWidth > viewportW - margin) left = Math.max(margin, viewportW - minWidth - margin);
    if (left < margin) left = margin;
    setDropdownStyle({
      top,
      left,
      minWidth: Math.min(minWidth, viewportW - 16),
      maxWidth: Math.min(480, viewportW - 16),
      maxHeight,
    });
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setDropdownStyle(null);
      setHoveredValue(null);
      setPreviewStyle(null);
      return;
    }
    updateDropdownPosition();
    window.addEventListener('scroll', updateDropdownPosition, true);
    window.addEventListener('resize', updateDropdownPosition);
    return () => {
      window.removeEventListener('scroll', updateDropdownPosition, true);
      window.removeEventListener('resize', updateDropdownPosition);
    };
  }, [isOpen, updateDropdownPosition]);

  useLayoutEffect(() => {
    if (!isOpen || !hoveredValue || !triggerRef.current) {
      setPreviewStyle(null);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth || 0;
    let left = rect.left;
    if (left + PREVIEW_W > viewportW - 8) left = Math.max(8, viewportW - PREVIEW_W - 8);
    const top = Math.max(8, rect.top - PREVIEW_GAP - 200);
    setPreviewStyle({ top, left });
  }, [isOpen, hoveredValue]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (selectRef.current?.contains(t)) return;
      if ((t as Element).closest?.('[data-table-layout-dropdown]')) return;
      if ((t as Element).closest?.('[data-table-layout-preview]')) return;
      setIsOpen(false);
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
      {isOpen && hoveredOption && previewStyle && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed z-[10001] max-w-[min(92vw,320px)] rounded-lg border border-gray-200 bg-white p-2 shadow-xl"
            style={{ top: previewStyle.top, left: previewStyle.left, width: PREVIEW_W }}
            data-table-layout-preview
          >
            <div className="mb-1.5 text-xs font-semibold text-gray-600">Preview:</div>
            {hoveredOption.preview}
          </div>,
          document.body
        )}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-white px-4 text-left transition-all duration-200',
          'border-[var(--border)] hover:border-gray-300',
          'focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:ring-offset-1 focus:border-[var(--brand)]',
          isOpen && 'border-[var(--brand)] ring-2 ring-[var(--brand)] ring-offset-1'
        )}
      >
        <span className={cn('min-w-0 truncate text-sm', selectedOption ? 'text-gray-900' : 'text-gray-400')}>
          {selectedOption?.label ?? 'Select layout...'}
        </span>
        <ChevronDown className={cn('h-5 w-5 shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen &&
        dropdownStyle &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-table-layout-dropdown
            className="fixed z-[10000] flex flex-col overflow-hidden rounded-lg border-2 border-gray-200 bg-white py-1 shadow-lg"
            style={{
              top: dropdownStyle.top,
              left: dropdownStyle.left,
              minWidth: dropdownStyle.minWidth,
              maxWidth: dropdownStyle.maxWidth,
              maxHeight: dropdownStyle.maxHeight,
            }}
            onMouseLeave={() => setHoveredValue(null)}
        >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {TABLE_LAYOUT_OPTIONS.map((option) => (
                <div key={option.value} onMouseEnter={() => setHoveredValue(option.value)}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setIsOpen(false);
                    }}
                    className={cn(
                      'w-full px-4 py-2.5 text-left text-sm transition-colors',
                      'hover:bg-orange-50',
                      value === option.value && 'bg-orange-50 font-semibold text-[var(--brand)]'
                    )}
                  >
                    {option.label}
                  </button>
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
