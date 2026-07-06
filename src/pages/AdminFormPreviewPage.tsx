import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchTemplateForForm } from '../lib/formEngine';
import type { FormTemplate } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Loader } from '../components/ui/Loader';
import { Stepper } from '../components/ui/Stepper';

const PDF_BASE = import.meta.env.VITE_PDF_API_URL ?? '';

export const AdminFormPreviewPage: React.FC = () => {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [pdfRefresh, setPdfRefresh] = useState(0);
  const numericFormId = Number(formId || 0);
  const livePreviewUrl = PDF_BASE
    ? `${PDF_BASE.replace(/\/$/, '')}/pdf/preview/form/${numericFormId}?t=${Date.now()}#toolbar=0`
    : '';
  const liveDownloadUrl = PDF_BASE
    ? `${PDF_BASE.replace(/\/$/, '')}/pdf/preview/form/${numericFormId}?download=1&t=${Date.now()}`
    : '';

  useEffect(() => {
    const id = Number(formId);
    if (!id) {
      setLoading(false);
      return;
    }
    fetchTemplateForForm(id, { allowInactiveForAdmin: true }).then((t) => {
      setTemplate(t || null);
      setLoading(false);
    });
  }, [formId]);

  const steps = template
    ? [
        { number: 1, label: 'Introduction', description: 'Preview mode' },
        ...template.steps.map((s, i) => ({ number: i + 2, label: s.title, description: s.subtitle || '' })),
      ]
    : [{ number: 1, label: 'Introduction', description: 'Preview mode' }];
  const isIntro = currentStep === 1;
  const stepData = template && !isIntro ? template.steps[currentStep - 2] : null;

  if (loading) return <Loader fullPage variant="dots" size="lg" message="Loading preview..." />;
  if (!template) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
        <Card className="max-w-xl w-full">
          <h2 className="text-lg font-bold text-[var(--text)] mb-2">Preview unavailable</h2>
          <p className="text-sm text-gray-600">Form could not be loaded.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="bg-white border-b border-[var(--border)] shadow-sm sticky top-0 z-20">
        <div className="w-full px-3 py-3 sm:px-4 md:px-6 md:py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-[var(--text)] break-words">{template.form.name}</h1>
              <p className="text-xs text-gray-500 mt-1">Admin preview mode (non-persistent): no instance record is created.</p>
            </div>
            <Button variant="outline" className="w-full shrink-0 sm:w-auto" onClick={() => navigate(-1)}>Back</Button>
          </div>
        </div>
      </header>

      <div className="w-full px-3 py-4 sm:px-4 md:px-6 md:py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-9 space-y-6">
            <Card>
              <Stepper steps={steps} currentStep={currentStep} />
            </Card>

            {isIntro ? (
              <Card>
                <h2 className="text-lg font-bold text-[var(--text)] mb-2">Form Overview</h2>
                <p className="text-sm text-gray-600">Version: {template.form.version || '1.0.0'}</p>
                <p className="text-sm text-gray-600">Unit: {template.form.unit_code || '-'} {template.form.unit_name || ''}</p>
                <p className="text-sm text-gray-600 mt-3">Use Next to inspect each step and question structure.</p>
              </Card>
            ) : (
              <Card>
                <h2 className="text-lg font-bold text-[var(--text)] mb-4">{stepData?.title}</h2>
                <div className="space-y-5">
                  {(stepData?.sections || []).map((section) => (
                    <div key={section.id} className="border border-[var(--border)] rounded-lg p-4">
                      <h3 className="font-semibold text-[var(--text)]">{section.title}</h3>
                      {section.description && <p className="text-sm text-gray-500 mt-1">{section.description}</p>}
                      <div className="mt-3 space-y-2">
                        {section.questions.map((q) => (
                          <div key={q.id} className="rounded-md bg-gray-50 px-3 py-2">
                            <div className="text-sm font-medium text-[var(--text)]">{q.label}</div>
                            <div className="text-xs text-gray-500 mt-1">
                              Type: {q.type} {q.required ? '• Required' : '• Optional'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => setCurrentStep((p) => Math.max(1, p - 1))} disabled={currentStep <= 1}>
                Previous
              </Button>
              <Button className="w-full sm:w-auto" onClick={() => setCurrentStep((p) => Math.min(steps.length, p + 1))} disabled={currentStep >= steps.length}>
                Next
              </Button>
            </div>
          </div>

          <div className="lg:col-span-3">
            <Card>
              <h3 className="font-bold text-[var(--text)] mb-4">PDF Preview</h3>
              <p className="text-sm text-gray-600 mb-3">
                Stored SharePoint PDFs apply to completed assessment instances. This form preview has no instance —
                use live PDF generation manually below (does not run automatically).
              </p>
              <div className="space-y-2">
                {PDF_BASE ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        window.open(livePreviewUrl, '_blank', 'width=900,height=700');
                        setPdfRefresh((r) => r + 1);
                      }}
                    >
                      Generate live PDF
                    </Button>
                    <a href={liveDownloadUrl} target="_blank" rel="noopener noreferrer" className="block">
                      <Button variant="outline" size="sm" className="w-full">
                        Download live PDF
                      </Button>
                    </a>
                  </>
                ) : (
                  <p className="text-sm text-gray-500">Set VITE_PDF_API_URL to enable live PDF preview.</p>
                )}
              </div>
              <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                Live PDF is not loaded automatically — this avoids overloading the Render PDF server.
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};
