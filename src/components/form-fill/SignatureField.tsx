import React, { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Edit2, X, PenLine } from 'lucide-react';

/** Signature value: image data URL (from draw) or plain text (typed name). */
function isImageSignature(value: string | null): value is string {
  return !!value && value.startsWith('data:');
}

interface SignatureFieldProps {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  className?: string;
  /** When provided and current value empty, show clickable preview of this signature (no text labels) */
  suggestionFrom?: string | null;
  /** @deprecated Use suggestion preview instead - no text labels shown */
  suggestionLabel?: string;
  onSuggestionClick?: () => void;
}

export const SignatureField: React.FC<SignatureFieldProps> = ({
  value,
  onChange,
  disabled,
  className = '',
  suggestionFrom,
  onSuggestionClick,
}) => {
  const canvasRef = useRef<SignatureCanvas>(null);
  const typedInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const hasValue = !!value;
  const showSuggestion = !hasValue && !!suggestionFrom && !!onSuggestionClick;
  const isImage = isImageSignature(value);
  const suggestionIsImage = suggestionFrom ? isImageSignature(suggestionFrom) : false;

  const handleSaveDraw = () => {
    if (canvasRef.current && !canvasRef.current.isEmpty()) {
      const dataUrl = canvasRef.current.toDataURL('image/png', 1.0);
      onChange(dataUrl);
      setIsModalOpen(false);
    }
  };

  const handleSaveType = (text: string) => {
    const trimmed = text.trim();
    onChange(trimmed || null);
    if (trimmed) setIsModalOpen(false);
  };

  const handleClear = () => {
    if (canvasRef.current) canvasRef.current.clear();
  };

  const handleClearSignature = () => {
    onChange(null);
  };

  return (
    <div className={`relative ${className}`}>
      <div
        className="border border-gray-400 rounded bg-white min-h-[60px] flex items-center justify-center p-2 relative"
      >
        {hasValue ? (
          <div className="flex items-center gap-2 w-full min-w-0">
            {isImage ? (
              <img
                src={value}
                alt="Signature"
                className="h-10 w-auto max-w-full object-contain rounded border border-gray-200"
              />
            ) : (
              <span className="text-red-600 italic font-serif text-sm font-medium truncate flex-1">
                {value}
              </span>
            )}
            {!disabled && (
              <div className="flex gap-1 flex-shrink-0">
                {isImage ? (
                  <button
                    type="button"
                    onClick={() => { setMode('draw'); setIsModalOpen(true); }}
                    className="p-1 rounded hover:bg-gray-100 text-gray-600"
                    title="Draw signature"
                  >
                    <PenLine className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setMode('type'); setIsModalOpen(true); }}
                    className="p-1 rounded hover:bg-gray-100 text-gray-600"
                    title="Type signature"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClearSignature}
                  className="p-1 rounded hover:bg-red-50 text-red-600"
                  title="Clear"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        ) : disabled ? (
          <span className="text-gray-400 italic text-xs">No signature</span>
        ) : (
          <div className="flex flex-col gap-1 w-full">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => { setMode('draw'); setIsModalOpen(true); }}
                className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
              >
                Draw
              </button>
              <button
                type="button"
                onClick={() => { setMode('type'); setIsModalOpen(true); }}
                className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-50"
              >
                Type name
              </button>
            </div>
            {showSuggestion && (
              <button
                type="button"
                onClick={onSuggestionClick}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-dashed border-gray-300 hover:border-gray-400 hover:bg-gray-50 text-left transition-colors"
                title="Use same signature"
              >
                {suggestionIsImage ? (
                  <img
                    src={suggestionFrom!}
                    alt=""
                    className="h-6 w-auto max-w-[80px] object-contain rounded border border-gray-200"
                  />
                ) : (
                  <span className="text-red-600 italic font-serif text-xs truncate max-w-[120px]">
                    {suggestionFrom}
                  </span>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={mode === 'draw' ? 'Draw Signature' : 'Type Signature'} size="md">
        {mode === 'draw' ? (
          <div className="space-y-4">
            <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-white">
              <SignatureCanvas
                ref={canvasRef}
                canvasProps={{
                  width: 600,
                  height: 240,
                  className: 'signature-canvas w-full',
                }}
                backgroundColor="#ffffff"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
              <Button variant="outline" onClick={handleClear}>Clear</Button>
              <Button variant="primary" onClick={handleSaveDraw}>Save Signature</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Type your name to use as signature (will appear in red italic):</p>
            <input
              ref={typedInputRef}
              type="text"
              defaultValue={!isImage ? (value || '') : ''}
              placeholder="e.g. John Smith"
              className="w-full border border-gray-300 rounded px-3 py-2 text-red-600 italic font-serif"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveType((e.target as HTMLInputElement).value);
              }}
            />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => handleSaveType(typedInputRef.current?.value ?? '')}>
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
