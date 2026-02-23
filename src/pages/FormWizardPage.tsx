import React, { useState, useMemo, Suspense, lazy } from 'react';
import { useFormStore } from '../store/formStore';
import { FormDefinition, FormSection } from '../types/formDefinition';
import { Stepper } from '../components/ui/Stepper';
import { PremiumWizardNav } from '../components/wizard/PremiumWizardNav';
import { PremiumDetailsTable } from '../components/wizard/PremiumDetailsTable';
import { PremiumLikertCardList } from '../components/wizard/PremiumLikertCardList';
import { PremiumTextarea } from '../components/wizard/PremiumTextarea';
import { PremiumCheckboxGroup } from '../components/wizard/PremiumCheckboxGroup';
import { PremiumSignatureBlock } from '../components/wizard/PremiumSignatureBlock';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { Loader } from '../components/ui/Loader';
import { canViewField, canEditField } from '../utils/roleUtils';
import formDefinitionData from '../data/formDefinition.json';

// Lazy load PDF preview component to split PDF library into separate chunk
const PremiumPdfPreviewCard = lazy(() => import('../components/wizard/PremiumPdfPreviewCard').then(m => ({ default: m.PremiumPdfPreviewCard })));

interface WizardStep {
  number: number;
  label: string;
  description: string;
  sections: FormSection[];
}

export const FormWizardPage: React.FC = () => {
  const formDefinition = formDefinitionData as FormDefinition;
  const { role, answers, setRole, studentSubmitted, trainerSubmitted } = useFormStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Map form definition to wizard steps
  const wizardSteps = useMemo<WizardStep[]>(() => {
    const steps: WizardStep[] = [];

    // Step 1: Student & Trainer details
    const page1 = formDefinition.pages.find((p) => p.pageNumber === 1);
    const studentTrainerSection = page1?.sections.find(
      (s) => s.type === 'detailsTable' && s.title === 'Student and trainer details'
    );
    if (studentTrainerSection) {
      steps.push({
        number: 1,
        label: 'Student & Trainer',
        description: 'Basic information about student and trainer',
        sections: [studentTrainerSection],
      });
    }

    // Step 2: Qualification & Unit
    const qualificationSection = page1?.sections.find(
      (s) => s.type === 'detailsTable' && s.title === 'Qualification and unit of competency'
    );
    if (qualificationSection) {
      steps.push({
        number: 2,
        label: 'Qualification & Unit',
        description: 'Course and unit details',
        sections: [qualificationSection],
      });
    }

    // Step 3: Logistics & Support Evaluation
    const page2 = formDefinition.pages.find((p) => p.pageNumber === 2);
    const logisticsLikert = page2?.sections.find(
      (s) => s.type === 'likertMatrix' && s.title === 'Logistics and Support Evaluation'
    );
    const logisticsComment = page2?.sections.find(
      (s) => s.type === 'textarea' && s.fieldId === 'logistics.comments'
    );
    if (logisticsLikert) {
      steps.push({
        number: 3,
        label: 'Logistics & Support',
        description: 'Evaluate logistics and support services',
        sections: [logisticsLikert, ...(logisticsComment ? [logisticsComment] : [])],
      });
    }

    // Step 4: Trainer/Assessor Evaluation
    const trainerLikert = page2?.sections.find(
      (s) => s.type === 'likertMatrix' && s.title === 'Trainer/Assessor Evaluation'
    );
    const trainerComment = page2?.sections.find(
      (s) => s.type === 'textarea' && s.fieldId === 'trainer.comments'
    );
    if (trainerLikert) {
      steps.push({
        number: 4,
        label: 'Trainer/Assessor',
        description: 'Evaluate trainer/assessor performance',
        sections: [trainerLikert, ...(trainerComment ? [trainerComment] : [])],
      });
    }

    // Step 5: Learning Evaluation
    const learningLikert = page2?.sections.find(
      (s) => s.type === 'likertMatrix' && s.title === 'Learning Evaluation'
    );
    const learningComment = page2?.sections.find(
      (s) => s.type === 'textarea' && s.fieldId === 'learning.comments'
    );
    if (learningLikert) {
      steps.push({
        number: 5,
        label: 'Learning',
        description: 'Evaluate learning experience',
        sections: [learningLikert, ...(learningComment ? [learningComment] : [])],
      });
    }

    // Step 6: Declarations & Signature
    const page3 = formDefinition.pages.find((p) => p.pageNumber === 3);
    const declarationsSection = page3?.sections.find(
      (s) => s.type === 'checkboxGroup' && s.title === 'Final Declarations'
    );
    const studentSignature = page3?.sections.find(
      (s) => s.type === 'signatureBlock' && s.fieldId === 'student.signature'
    );
    const trainerSignature = page3?.sections.find(
      (s) => s.type === 'signatureBlock' && s.fieldId === 'trainer.signature'
    );
    const officeSection = page3?.sections.find(
      (s) => s.type === 'detailsTable' && s.title === 'Office Use Only'
    );

    const step6Sections: FormSection[] = [];
    if (declarationsSection) step6Sections.push(declarationsSection);
    if (studentSignature) step6Sections.push(studentSignature);
    if (trainerSignature) step6Sections.push(trainerSignature);
    if (officeSection) step6Sections.push(officeSection);

    if (step6Sections.length > 0) {
      steps.push({
        number: 6,
        label: 'Declarations & Signature',
        description: 'Final declarations and signatures',
        sections: step6Sections,
      });
    }

    return steps;
  }, [formDefinition]);

  // Calculate completion percentage
  const completionPercent = useMemo(() => {
    let totalFields = 0;
    let filledFields = 0;

    wizardSteps.forEach((step) => {
      step.sections.forEach((section) => {
        if (section.type === 'detailsTable') {
          section.fields.forEach((field) => {
            // Use same view logic as PremiumDetailsTable
            const fieldPrefix = field.fieldId.split('.')[0];
            const canView = 
              canViewField(role, field.roleScope) || 
              (fieldPrefix === 'student' && (role === 'student' || role === 'trainer' || role === 'office')) ||
              (fieldPrefix === 'trainer' && (role === 'student' || role === 'trainer' || role === 'office')) ||
              (fieldPrefix === 'office' && role === 'office');
            
            if (canView) {
              totalFields++;
              if (answers[field.fieldId]?.toString().trim()) {
                filledFields++;
              }
            }
          });
        } else if (section.type === 'likertMatrix') {
          section.questions.forEach((q) => {
            if (canViewField(role, q.roleScope)) {
              totalFields++;
              if (answers[q.fieldId]) {
                filledFields++;
              }
            }
          });
        } else if (section.type === 'textarea') {
          if (canViewField(role, section.roleScope)) {
            totalFields++;
            if (answers[section.fieldId]?.toString().trim()) {
              filledFields++;
            }
          }
        } else if (section.type === 'checkboxGroup') {
          section.options.forEach((opt) => {
            if (canViewField(role, opt.roleScope)) {
              totalFields++;
              if (answers[opt.fieldId]) {
                filledFields++;
              }
            }
          });
        } else if (section.type === 'signatureBlock') {
          if (canViewField(role, section.roleScope)) {
            totalFields++;
            const sig = section.fieldId === 'student.signature' ? 'studentSignature' : 'trainerSignature';
            const signature = useFormStore.getState()[sig];
            if (signature?.imageDataUrl || signature?.typedText) {
              filledFields++;
            }
          }
        }
      });
    });

    return totalFields > 0 ? (filledFields / totalFields) * 100 : 0;
  }, [wizardSteps, answers, role]);

  // Validate current step
  const validateStep = (stepNumber: number): boolean => {
    const step = wizardSteps.find((s) => s.number === stepNumber);
    if (!step) return true;

    const stepErrors: Record<string, string> = {};

    step.sections.forEach((section) => {
      if (section.type === 'detailsTable') {
        section.fields.forEach((field) => {
          // Only validate fields that the current role can edit
          const fieldPrefix = field.fieldId.split('.')[0];
          const canView = 
            canViewField(role, field.roleScope) || 
            (fieldPrefix === 'student' && (role === 'student' || role === 'trainer' || role === 'office')) ||
            (fieldPrefix === 'trainer' && (role === 'student' || role === 'trainer' || role === 'office')) ||
            (fieldPrefix === 'office' && role === 'office');
          const canEdit = canEditField(role, field.roleScope, studentSubmitted, trainerSubmitted);
          
          if (canView && canEdit) {
            const value = answers[field.fieldId]?.toString().trim();
            if (!value) {
              stepErrors[field.fieldId] = `${field.label} is required`;
            }
          }
        });
      } else if (section.type === 'likertMatrix') {
        section.questions.forEach((q) => {
          if (canViewField(role, q.roleScope) && canEditField(role, q.roleScope, studentSubmitted, trainerSubmitted)) {
            if (!answers[q.fieldId]) {
              stepErrors[q.fieldId] = 'Please select a rating for this question';
            }
          }
        });
      } else if (section.type === 'checkboxGroup') {
        section.options.forEach((opt) => {
          if (canViewField(role, opt.roleScope) && canEditField(role, opt.roleScope, studentSubmitted, trainerSubmitted)) {
            if (!answers[opt.fieldId]) {
              stepErrors[opt.fieldId] = 'This declaration must be acknowledged';
            }
          }
        });
      }
    });

    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  };

  const handleNext = async () => {
    if (validateStep(currentStep)) {
      if (currentStep < wizardSteps.length) {
        setCurrentStep(currentStep + 1);
        setErrors({});
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (currentStep === wizardSteps.length) {
        // Last step - export PDF
        try {
          const { exportPdf } = await import('../utils/pdfExport');
          const { toast } = await import('../utils/toast');
          await exportPdf(role);
          toast.success('PDF Exported & Downloaded Successfully! 🎉', 5000);
        } catch (error) {
          console.error('Error exporting PDF:', error);
          const { toast } = await import('../utils/toast');
          toast.error('Failed to export PDF. Please try again.', 4000);
        }
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setErrors({});
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSaveDraft = () => {
    // Draft is auto-saved via Zustand persist middleware
    alert('Draft saved to localStorage');
  };

  const currentStepData = wizardSteps.find((s) => s.number === currentStep);

  const renderSection = (section: FormSection) => {
    switch (section.type) {
      case 'detailsTable':
        return <PremiumDetailsTable key={section.title} section={section} errors={errors} />;
      case 'likertMatrix':
        return <PremiumLikertCardList key={section.title} section={section} errors={errors} />;
      case 'textarea':
        return <PremiumTextarea key={section.fieldId} section={section} errors={errors} />;
      case 'checkboxGroup':
        return <PremiumCheckboxGroup key={section.title} section={section} errors={errors} />;
      case 'signatureBlock':
        return <PremiumSignatureBlock key={section.fieldId} section={section} errors={errors} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Header */}
      <div className="bg-white border-b border-[var(--border)] shadow-sm sticky top-0 z-20">
        <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-3 sm:py-4 md:py-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-[var(--text)] truncate">
                {formDefinition.meta.title}
              </h1>
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5 truncate">{formDefinition.meta.orgName}</p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <label className="text-xs sm:text-sm font-semibold text-gray-700 whitespace-nowrap">Role:</label>
              <Select
                value={role}
                onChange={(value) => setRole(value as any)}
                options={[
                  { value: 'student', label: 'Student' },
                  { value: 'trainer', label: 'Trainer' },
                  { value: 'office', label: 'Office' },
                ]}
                className="w-28 sm:w-32 md:w-36"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="w-full px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 md:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
          {/* Left: Wizard Form */}
          <div className="lg:col-span-9 space-y-4 sm:space-y-6">
            {/* Stepper Card */}
            <Card>
              <div className="mb-4 sm:mb-6">
                <h2 className="text-lg sm:text-xl font-bold text-[var(--text)] mb-1">
                  Training Evaluation Form
                </h2>
                <p className="text-xs sm:text-sm text-gray-600">Complete all steps to generate your evaluation form</p>
              </div>
              <Stepper
                steps={wizardSteps.map((s) => ({
                  number: s.number,
                  label: s.label,
                  description: s.description,
                }))}
                currentStep={currentStep}
              />
            </Card>

            {/* Step Content Card */}
            {currentStepData && (
              <Card>
                <div className="mb-4 sm:mb-6 md:mb-8">
                  <h2 className="text-xl sm:text-2xl font-bold text-[var(--text)] mb-1 sm:mb-2">
                    Step {currentStep}: {currentStepData.label}
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-600">{currentStepData.description}</p>
                </div>

                <div className="space-y-4 sm:space-y-6">
                  {currentStepData.sections.map((section) => renderSection(section))}
                </div>

                {/* Navigation */}
                <PremiumWizardNav
                  currentStep={currentStep}
                  totalSteps={wizardSteps.length}
                  onBack={handleBack}
                  onNext={handleNext}
                  onSaveDraft={handleSaveDraft}
                  canGoBack={currentStep > 1}
                  canGoNext={true}
                  isLastStep={currentStep === wizardSteps.length}
                  completionPercent={completionPercent}
                />
              </Card>
            )}
          </div>

          {/* Right: PDF Preview - Hidden on mobile, shown on tablet+ */}
          <div className="lg:col-span-3 hidden md:block">
            <div className="lg:sticky lg:top-4">
              <Suspense fallback={<Loader variant="dots" size="md" message="Loading PDF preview..." />}>
                <PremiumPdfPreviewCard role={role} />
              </Suspense>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
