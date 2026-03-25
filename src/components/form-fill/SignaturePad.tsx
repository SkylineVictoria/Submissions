import React, { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Edit2, X, PenLine } from 'lucide-react';

/** Value is image data URL (drawn) or plain text (typed). */
function isImageSignature(value: string | null): value is string {
  return !!value && value.startsWith('data:');
}

interface SignaturePadProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  error?: string;
  /** Highlight background when the current user needs to fill this field */
  highlight?: boolean;
}

export const SignaturePad: React.FC<SignaturePadProps> = ({
  label,
  value,
  onChange,
  disabled,
  error,
  highlight = false,
}) => {
  const canvasRef = useRef<SignatureCanvas>(null);
  const typedInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');

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

  const hasValue = !!value;
  const isImage = isImageSignature(value);

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-gray-700 whitespace-pre-line">
        {label}
        {error && <span className="text-red-600 ml-1">*</span>}
      </div>
      <div
        className={`border-2 border-[var(--border)] rounded-lg min-h-[120px] flex items-center justify-center ${
          !disabled && highlight ? 'bg-blue-50/70' : 'bg-white'
        }`}
        style={{ minHeight: '120px' }}
      >
        {hasValue ? (
          <div className="h-full flex items-center justify-center p-2">
            <div className="flex items-center gap-2">
              {isImage ? (
                <img
                  src={value}
                  alt="Signature"
                  className="h-12 w-auto rounded border border-[var(--border)]"
                />
              ) : (
                <span className="text-red-600 italic font-serif text-base font-medium">
                  {value}
                </span>
              )}
              {!disabled && (
                <div className="flex gap-1">
                  {isImage ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setMode('draw'); setIsModalOpen(true); }}
                      title="Draw signature"
                    >
                      <PenLine className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setMode('type'); setIsModalOpen(true); }}
                      title="Type signature"
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearSignature}
                    className="text-red-600"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : disabled ? (
          <span className="text-gray-500 italic text-sm">No signature</span>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setMode('draw'); setIsModalOpen(true); }}>
              Draw
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setMode('type'); setIsModalOpen(true); }}>
              Type name
            </Button>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={mode === 'draw' ? 'Draw Signature' : 'Type Signature'} size="md">
        {mode === 'draw' ? (
          <div className="space-y-4">
            <div className="border-2 border-[var(--border)] rounded-lg overflow-hidden bg-white">
              <SignatureCanvas
                ref={canvasRef}
                penColor="#dc2626"
                canvasProps={{
                  width: 600,
                  height: 320,
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
            <p className="text-sm text-gray-600">Type your name (will appear as red italic signature):</p>
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
              <Button variant="primary" onClick={() => handleSaveType(typedInputRef.current?.value ?? '')}>Save</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
