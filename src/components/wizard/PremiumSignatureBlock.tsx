import React, { useRef, useEffect, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { SignatureBlockSection } from '../../types/formDefinition';
import { useFormStore } from '../../store/formStore';
import { canViewField, canEditField } from '../../utils/roleUtils';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Edit2, X, PenLine } from 'lucide-react';

interface PremiumSignatureBlockProps {
  section: SignatureBlockSection;
  errors?: Record<string, string>;
}

export const PremiumSignatureBlock: React.FC<PremiumSignatureBlockProps> = ({ section, errors: _errors = {} }) => {
  const {
    role,
    studentSignature,
    trainerSignature,
    answers,
    studentSubmitted,
    trainerSubmitted,
    setStudentSignature,
    setTrainerSignature,
    updateAnswer,
  } = useFormStore();

  const modalSigPadRef = useRef<SignatureCanvas>(null);
  const typedInputRef = useRef<HTMLInputElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const isStudentSig = section.fieldId === 'student.signature';
  const isTrainerSig = section.fieldId === 'trainer.signature';

  // Determine which signature to use
  const signature = isStudentSig ? studentSignature : isTrainerSig ? trainerSignature : null;
  const isStudentRole = role === 'student';
  const isTrainerRole = role === 'trainer';
  const isOfficeRole = role === 'office';

  // Privacy: Hide signature from opposite role
  const shouldHideSignature = () => {
    if (isOfficeRole) return false;
    if (isStudentSig && isTrainerRole) return true;
    if (isTrainerSig && isStudentRole) return true;
    return false;
  };

  const canView = canViewField(role, section.roleScope);
  const canEdit = canEditField(role, section.roleScope, studentSubmitted, trainerSubmitted);
  const hideSignature = shouldHideSignature();

  // Initialize modal canvas when opened
  useEffect(() => {
    if (isModalOpen && modalSigPadRef.current && signature?.imageDataUrl) {
      // Restore existing signature if available
      setTimeout(() => {
        if (modalSigPadRef.current && signature?.imageDataUrl) {
          const img = new Image();
          img.src = signature.imageDataUrl;
          img.onload = () => {
            if (modalSigPadRef.current) {
              const canvas = modalSigPadRef.current.getCanvas();
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              }
            }
          };
        }
      }, 100);
    }
  }, [isModalOpen, signature?.imageDataUrl]);

  if (!canView || hideSignature) return null;

  const handleClear = () => {
    if (modalSigPadRef.current) {
      modalSigPadRef.current.clear();
    }
  };

  const handleSaveDraw = () => {
    if (modalSigPadRef.current && !modalSigPadRef.current.isEmpty()) {
      const dataUrl = modalSigPadRef.current.toDataURL('image/png', 1.0);
      const date = new Date().toISOString().split('T')[0];
      if (isStudentSig) {
        setStudentSignature({ imageDataUrl: dataUrl, typedText: null, signedAtDate: date });
      } else if (isTrainerSig) {
        setTrainerSignature({ imageDataUrl: dataUrl, typedText: null, signedAtDate: date });
      }
      setIsModalOpen(false);
    }
  };

  const handleSaveType = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const date = new Date().toISOString().split('T')[0];
    if (isStudentSig) {
      setStudentSignature({ imageDataUrl: null, typedText: trimmed, signedAtDate: date });
    } else if (isTrainerSig) {
      setTrainerSignature({ imageDataUrl: null, typedText: trimmed, signedAtDate: date });
    }
    setIsModalOpen(false);
  };

  const handleClearSignature = () => {
    if (isStudentSig) {
      setStudentSignature({ imageDataUrl: null, typedText: null, signedAtDate: null });
    } else if (isTrainerSig) {
      setTrainerSignature({ imageDataUrl: null, typedText: null, signedAtDate: null });
    }
  };

  const hasSignature = !!(signature?.imageDataUrl || signature?.typedText);

  const nameFieldId = `${section.fieldId}.name`;
  const dateFieldId = `${section.fieldId}.date`;
  
  // Auto-populate name from student.fullName or trainer.fullName if signature name is empty
  useEffect(() => {
    const fullNameFieldId = isStudentSig ? 'student.fullName' : 'trainer.fullName';
    const fullName = answers[fullNameFieldId] || '';
    const currentName = answers[nameFieldId] || '';
    
    // Only auto-populate if fullName exists and signature name is empty
    if (fullName && !currentName) {
      updateAnswer(nameFieldId, fullName);
    }
  }, [answers, nameFieldId, isStudentSig, updateAnswer]);
  
  const nameValue = answers[nameFieldId] || '';
  const dateValue = answers[dateFieldId] || signature?.signedAtDate || '';

  return (
    <>
      <Card className="mb-4 sm:mb-6">
        <div className="mb-3 sm:mb-4">
          <h3 className="text-lg sm:text-xl font-bold text-[var(--text)] mb-1">{section.label}</h3>
          <p className="text-xs sm:text-sm text-gray-600">Please provide your signature below</p>
        </div>
        <div className="space-y-3 sm:space-y-4">
          {section.showNameField && (
            <Input
              label={isStudentSig ? 'Student Name' : 'Trainer/Assessor Name'}
              type="text"
              value={nameValue}
              onChange={(e) => updateAnswer(nameFieldId, e.target.value)}
              disabled={!canEdit}
              placeholder={`Enter ${isStudentSig ? 'student' : 'trainer'} name`}
            />
          )}
          <div>
            <label className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2">
              {isStudentSig ? 'Student Signature' : 'Trainer/Assessor Signature'}
            </label>
            {canEdit ? (
              <div
                className="border-2 border-[var(--border)] rounded-lg bg-white"
                style={{ height: '120px', minHeight: '120px' }}
              >
                {hasSignature ? (
                  <div className="h-full flex items-center justify-center p-2 sm:p-4">
                    <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
                      <div className="flex-shrink-0">
                        {signature?.imageDataUrl ? (
                          <img
                            src={signature.imageDataUrl}
                            alt="Signature"
                            className="h-12 sm:h-16 w-auto rounded border border-[var(--border)] bg-white shadow-sm"
                          />
                        ) : (
                          <span className="text-red-600 italic font-serif text-base sm:text-lg font-medium">
                            {signature?.typedText}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1.5 sm:gap-2">
                        {signature?.imageDataUrl ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setMode('draw'); setIsModalOpen(true); }}
                            className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3"
                            title="Draw signature"
                          >
                            <PenLine className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                            <span className="hidden sm:inline">Draw</span>
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setMode('type'); setIsModalOpen(true); }}
                            className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3"
                            title="Type signature"
                          >
                            <Edit2 className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                            <span className="hidden sm:inline">Type</span>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleClearSignature}
                          className="flex items-center gap-1 sm:gap-2 text-red-600 hover:text-red-700 text-xs sm:text-sm px-2 sm:px-3"
                        >
                          <X className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                          <span className="hidden sm:inline">Clear</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center gap-2 p-2 sm:p-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setMode('draw'); setIsModalOpen(true); }}
                      className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"
                    >
                      <PenLine className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                      <span>Draw</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setMode('type'); setIsModalOpen(true); }}
                      className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm"
                    >
                      <Edit2 className="w-3.5 sm:w-4 h-3.5 sm:h-4" />
                      <span>Type name</span>
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="border-2 border-[var(--border)] rounded-lg bg-gray-50"
                style={{ height: '120px', minHeight: '120px' }}
              >
                <div className="h-full flex items-center justify-center p-2 sm:p-4">
                  {signature?.imageDataUrl ? (
                    <img
                      src={signature.imageDataUrl}
                      alt="Signature"
                      className="h-12 sm:h-16 mx-auto rounded border border-[var(--border)] bg-white shadow-sm"
                    />
                  ) : signature?.typedText ? (
                    <p className="text-xs sm:text-sm font-medium text-red-600 italic text-center font-serif">{signature.typedText}</p>
                  ) : nameValue ? (
                    <p className="text-xs sm:text-sm font-medium text-blue-600 italic text-center">{nameValue}</p>
                  ) : (
                    <span className="text-gray-500 italic text-xs sm:text-sm">No signature saved</span>
                  )}
                </div>
              </div>
            )}
          </div>
          {section.showDateField && (
            <Input
              label="Date"
              type="date"
              value={dateValue}
              onChange={(e) => {
                updateAnswer(dateFieldId, e.target.value);
                if (isStudentSig && signature) {
                  setStudentSignature({ ...signature, signedAtDate: e.target.value });
                } else if (isTrainerSig && signature) {
                  setTrainerSignature({ ...signature, signedAtDate: e.target.value });
                }
              }}
              disabled={!canEdit}
            />
          )}
        </div>
      </Card>

      {/* Signature Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={mode === 'draw' ? 'Draw Signature' : 'Type Signature'}
        size="md"
      >
        {mode === 'draw' ? (
          <div className="space-y-4">
            <div className="border-2 border-[var(--border)] rounded-lg overflow-hidden bg-white">
              <SignatureCanvas
                ref={modalSigPadRef}
                canvasProps={{
                  width: 600,
                  height: 320,
                  className: 'signature-canvas w-full',
                }}
                backgroundColor="#ffffff"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setIsModalOpen(false)} size="md">Cancel</Button>
              <Button variant="outline" onClick={handleClear} size="md">Clear</Button>
              <Button variant="primary" onClick={handleSaveDraw} size="md">
                Save Signature
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Type your name (will appear as red italic signature):</p>
            <input
              ref={typedInputRef}
              type="text"
              defaultValue={signature?.typedText ?? ''}
              placeholder="e.g. John Smith"
              className="w-full border border-gray-300 rounded px-3 py-2 text-red-600 italic font-serif"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveType((e.target as HTMLInputElement).value);
              }}
            />
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setIsModalOpen(false)} size="md">Cancel</Button>
              <Button variant="primary" onClick={() => handleSaveType(typedInputRef.current?.value ?? '')} size="md">Save</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

