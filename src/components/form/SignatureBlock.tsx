import React, { useRef, useEffect, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { SignatureBlockSection } from '../../types/formDefinition';
import { useFormStore } from '../../store/formStore';
import { canViewField, canEditField } from '../../utils/roleUtils';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Edit2, X } from 'lucide-react';

interface SignatureBlockProps {
  section: SignatureBlockSection;
}

export const SignatureBlock: React.FC<SignatureBlockProps> = ({ section }) => {
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
  const [isModalOpen, setIsModalOpen] = useState(false);
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

  const handleSave = () => {
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

  const handleClearSignature = () => {
    if (isStudentSig) {
      setStudentSignature({ imageDataUrl: null, typedText: null, signedAtDate: null });
    } else if (isTrainerSig) {
      setTrainerSignature({ imageDataUrl: null, typedText: null, signedAtDate: null });
    }
  };

  const nameFieldId = `${section.fieldId}.name`;
  const dateFieldId = `${section.fieldId}.date`;
  const nameValue = answers[nameFieldId] || '';
  const dateValue = answers[dateFieldId] || signature?.signedAtDate || '';

  return (
    <>
      <Card className="mb-6">
        <div className="mb-4">
          <h3 className="text-xl font-bold text-[var(--text)] mb-1">{section.label}</h3>
          <p className="text-sm text-gray-600">Please provide your signature below</p>
        </div>
        <div className="space-y-4">
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
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {isStudentSig ? 'Student Signature' : 'Trainer/Assessor Signature'}
            </label>
            {canEdit ? (
              <div className="border border-[var(--border)] rounded-lg bg-white" style={{ height: '140px' }}>
                {signature?.imageDataUrl ? (
                  <div className="h-full flex items-center justify-center p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0">
                        <img
                          src={signature.imageDataUrl}
                          alt="Signature"
                          className="h-16 w-auto rounded border border-[var(--border)] bg-white"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsModalOpen(true)}
                          className="flex items-center gap-2"
                        >
                          <Edit2 className="w-4 h-4" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleClearSignature}
                          className="flex items-center gap-2 text-red-600 hover:text-red-700"
                        >
                          <X className="w-4 h-4" />
                          Clear
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center">
                    {nameValue ? (
                      <button
                        type="button"
                        onClick={() => setIsModalOpen(true)}
                        className="text-blue-600 italic text-sm font-medium hover:text-blue-700 hover:underline cursor-pointer transition-colors px-4 py-2"
                        style={{ color: '#2563eb', fontStyle: 'italic' }}
                      >
                        {nameValue}
                      </button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsModalOpen(true)}
                        className="flex items-center gap-2"
                      >
                        Add Signature
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="border border-[var(--border)] rounded-lg bg-gray-50" style={{ height: '140px' }}>
                <div className="h-full flex items-center justify-center">
                  {signature?.imageDataUrl ? (
                    <img
                      src={signature.imageDataUrl}
                      alt="Signature"
                      className="h-16 mx-auto rounded border border-[var(--border)] bg-white"
                    />
                  ) : nameValue ? (
                    <p className="text-sm font-medium" style={{ color: '#2563eb', fontStyle: 'italic' }}>
                      {nameValue}
                    </p>
                  ) : (
                    <span className="text-gray-500 italic text-sm">No signature saved</span>
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
        title="Sign Here"
        size="md"
      >
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
            <Button variant="outline" onClick={() => setIsModalOpen(false)} size="md">
              Cancel
            </Button>
            <Button variant="outline" onClick={handleClear} size="md">
              Clear
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              size="md"
              disabled={modalSigPadRef.current?.isEmpty()}
            >
              Save Signature
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
