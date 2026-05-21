import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SlitDocumentHeader } from '../components/SlitDocumentHeader';
import {
  AttachmentField,
  CheckboxGroup,
  CheckOption,
  DateField,
  MonthYearField,
  YearField,
  FieldErrorMsg,
  PhoneField,
  PostcodeField,
  RadioGroup,
  ScrollToTopButton,
  SectionHeading,
  SelectField,
  SignatureFieldRow,
  TextField,
} from '../components/enrolment/EnrolmentFormUi';
import {
  COUNTRY_OPTIONS,
  COURSE_CREDIT_OPTIONS,
  DECLARATION_ITEMS,
  DISABILITY_OPTIONS,
  DISABILITY_TYPE_OPTIONS,
  EMPLOYMENT_STATUS_OPTIONS,
  ENGLISH_ASSESSMENT_OPTIONS,
  ENGLISH_PROFICIENCY_MAPPING,
  FALLBACK_COURSE_OPTIONS,
  GENDER_OPTIONS,
  HEAR_ABOUT_OPTIONS,
  INDIGENOUS_OPTIONS,
  LANGUAGE_OPTIONS,
  OSHC_COVER_OPTIONS,
  OSHC_OPTIONS,
  PREFERENCE_CHOICE_OPTIONS,
  PRIOR_EDUCATION_OPTIONS,
  PRIOR_EDUCATION_TYPE_OPTIONS,
  SCHOOL_LEVEL_OPTIONS,
  STUDY_REASON_OPTIONS,
  TITLE_OPTIONS,
  YES_NO_OPTIONS,
} from '../constants/enrolmentOptions';
import {
  createEnrolmentDraft,
  loadEnrolmentDraft,
  saveEnrolmentDraft,
  sendEnrolmentSubmissionEmails,
  submitEnrolmentApplication,
} from '../lib/enrolmentApi';
import { emptyEnrolmentFormValues } from '../lib/enrolmentDefaults';
import {
  attachmentFilesOnly,
  enrolmentPdfBlobToBase64,
  enrolmentPdfFilename,
  generateEnrolmentPdfBlob,
} from '../lib/enrolmentPdf';
import {
  clearEnrolmentSession,
  enrolmentSessionHasMeaningfulData,
  readEnrolmentSession,
  readEnrolmentSubmitted,
  readLegacyApplicationId,
  writeEnrolmentSession,
  writeEnrolmentSubmitted,
  type EnrolmentSubmittedCache,
} from '../lib/enrolmentSessionCache';
import {
  maxBytesForField,
  removeEnrolmentStorageObject,
  uploadEnrolmentDocument,
  validateEnrolmentFile,
} from '../lib/enrolmentStorage';
import {
  enrolmentSubmitSchema,
  ENROLMENT_VALIDATION_TOAST_MS,
  formatEnrolmentValidationToast,
  requiredEnrolmentChecklistItems,
} from '../lib/enrolmentValidation';
import { listCourses } from '../lib/formEngine';
import type { EnrolmentFileRef, EnrolmentFormValues } from '../types/enrolment';
import { toast } from '../utils/toast';
import '../styles/enrolmentForm.css';

type PendingFile = { section: string; field: string; file: File };

const initialSession = readEnrolmentSession();
const initialSubmitted = readEnrolmentSubmitted();
const initialApplicationId =
  initialSession?.applicationId ?? initialSubmitted?.applicationId ?? readLegacyApplicationId();

export const EnrollNowPage: React.FC = () => {
  const sessionRestoredRef = useRef(
    Boolean(initialSession && enrolmentSessionHasMeaningfulData(initialSession.values))
  );

  const [applicationId, setApplicationId] = useState<string | null>(initialApplicationId);
  const [fileRefs, setFileRefs] = useState<EnrolmentFileRef[]>(initialSession?.fileRefs ?? []);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(Boolean(initialSubmitted));
  const [applicationNo, setApplicationNo] = useState<string | null>(initialSubmitted?.applicationNo ?? null);
  const [submittedSnapshot, setSubmittedSnapshot] = useState<EnrolmentSubmittedCache | null>(initialSubmitted);
  const [emailDeliveryNote, setEmailDeliveryNote] = useState<string | null>(
    initialSubmitted?.emailDeliveryNote ?? null
  );
  const [courseOpts, setCourseOpts] = useState(
    FALLBACK_COURSE_OPTIONS.map((c) => ({ value: c.id, label: c.label }))
  );

  const form = useForm<EnrolmentFormValues>({
    defaultValues: initialSession?.values ?? emptyEnrolmentFormValues(),
    resolver: zodResolver(enrolmentSubmitSchema),
    mode: 'onBlur',
  });

  const { register, watch, setValue, reset, handleSubmit, formState: { errors }, trigger } = form;
  const values = watch();

  useEffect(() => {
    void trigger(['personal.mobile', 'personal.workPhone']);
  }, [values.address.type, trigger]);

  useEffect(() => {
    void trigger(['emergency.contactNumber']);
  }, [values.emergency.inAustralia, trigger]);

  useEffect(() => {
    void listCourses().then((list) => {
      if (list.length > 0) {
        setCourseOpts(
          list.map((c) => ({
            value: String(c.id),
            label: [c.qualification_code, c.name].filter(Boolean).join(' - ') || c.name,
          }))
        );
      }
    });
  }, []);

  // Persist form to sessionStorage while this browser tab is open (survives refresh).
  useEffect(() => {
    if (submitted) return;
    const timer = window.setTimeout(() => {
      writeEnrolmentSession({
        applicationId,
        values,
        fileRefs,
        updatedAt: Date.now(),
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [values, applicationId, fileRefs, submitted]);

  // Restore from Supabase only when there is no session cache (e.g. new device / cleared storage).
  useEffect(() => {
    if (!applicationId || sessionRestoredRef.current) return;
    let cancelled = false;
    void (async () => {
      const loaded = await loadEnrolmentDraft(applicationId);
      if (cancelled) return;
      if (!loaded.ok || !enrolmentSessionHasMeaningfulData(loaded.values)) {
        setApplicationId(null);
        clearEnrolmentSession();
        return;
      }
      if (loaded.status === 'submitted') {
        clearEnrolmentSession();
        setApplicationNo(loaded.applicationNo);
        setSubmitted(true);
        return;
      }
      reset(loaded.values);
      setFileRefs(loaded.files);
      sessionRestoredRef.current = true;
      toast.success('Your saved application has been restored.');
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId, reset]);

  const onFilePick = useCallback((section: string, field: string, file: File | null) => {
    const key = `${section}.${field}`;
    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPendingFiles((prev) => {
      const rest = prev.filter((p) => !(p.section === section && p.field === field));
      return file ? [...rest, { section, field, file }] : rest;
    });
  }, []);

  /** Upload a snapshot of pending picks once (avoids double upload when state has not re-rendered yet). */
  const uploadPendingFiles = useCallback(
    async (appId: string, queue: PendingFile[]): Promise<EnrolmentFileRef[]> => {
      if (queue.length === 0) return fileRefs;

      let next = [...fileRefs];
      for (const p of queue) {
        const err = validateEnrolmentFile(p.file, maxBytesForField(p.field));
        if (err) throw new Error(err);
        const previous = next.find((f) => f.section === p.section && f.field === p.field);
        const { ref, error } = await uploadEnrolmentDocument(appId, p.section, p.field, p.file);
        if (error || !ref) throw new Error(error ?? 'Upload failed');
        if (previous?.path) await removeEnrolmentStorageObject(previous.path);
        next = next.filter((f) => !(f.section === p.section && f.field === p.field));
        next.push(ref);
      }

      setFileRefs(next);
      setPendingFiles((prev) =>
        prev.filter((p) => !queue.some((q) => q.section === p.section && q.field === p.field))
      );
      return next;
    },
    [fileRefs]
  );

  const ensureApplicationId = useCallback(async (): Promise<{ id: string; files: EnrolmentFileRef[] } | null> => {
    if (!enrolmentSessionHasMeaningfulData(values)) {
      toast.error('Enter at least your name or email before saving.');
      return null;
    }

    const email = values.personal.email.trim();
    let files = fileRefs;
    const pendingSnapshot = [...pendingFiles];
    let id: string;
    let restoredExistingDraft = false;

    if (email) {
      const upserted = await createEnrolmentDraft(values, files);
      if (!upserted.ok || !upserted.id) {
        toast.error(upserted.error ?? 'Could not start application');
        return null;
      }
      id = upserted.id;
      restoredExistingDraft = Boolean(upserted.updated);
      if (applicationId && applicationId !== id) {
        restoredExistingDraft = true;
      }
    } else if (applicationId) {
      const saved = await saveEnrolmentDraft(applicationId, values, files);
      if (!saved.ok) {
        toast.error(saved.error ?? 'Could not save application');
        return null;
      }
      id = applicationId;
    } else {
      const created = await createEnrolmentDraft(values, files);
      if (!created.ok || !created.id) {
        toast.error(created.error ?? 'Could not start application');
        return null;
      }
      id = created.id;
    }

    if (pendingSnapshot.length > 0) {
      files = await uploadPendingFiles(id, pendingSnapshot);
      if (email) {
        const upserted = await createEnrolmentDraft(values, files);
        if (!upserted.ok) {
          toast.error(upserted.error ?? 'Could not save application');
          return null;
        }
        id = upserted.id;
      } else {
        const saved = await saveEnrolmentDraft(id, values, files);
        if (!saved.ok) {
          toast.error(saved.error ?? 'Could not save application');
          return null;
        }
      }
    }

    if (restoredExistingDraft) {
      toast.success('Your existing draft for this email has been updated.');
    }

    setApplicationId(id);
    setFileRefs(files);
    writeEnrolmentSession({
      applicationId: id,
      values,
      fileRefs: files,
      updatedAt: Date.now(),
    });
    return { id, files };
  }, [applicationId, values, fileRefs, pendingFiles, uploadPendingFiles]);

  const hasFile = (section: string, field: string) =>
    fileRefs.some((f) => f.section === section && f.field === field) ||
    pendingFiles.some((p) => p.section === section && p.field === field);

  const attachmentInfo = (section: string, field: string) => {
    const pending = pendingFiles.find((p) => p.section === section && p.field === field);
    if (pending) return { name: pending.file.name, uploaded: false as const };
    const ref = fileRefs.find((f) => f.section === section && f.field === field);
    if (ref) return { name: ref.name, uploaded: true as const };
    return { name: null, uploaded: false as const };
  };

  const clearAttachment = (section: string, field: string) => {
    const existing = fileRefs.find((f) => f.section === section && f.field === field);
    if (existing?.path) void removeEnrolmentStorageObject(existing.path);
    setPendingFiles((prev) => prev.filter((p) => !(p.section === section && p.field === field)));
    setFileRefs((prev) => prev.filter((f) => !(f.section === section && f.field === field)));
    setFileErrors((prev) => {
      const next = { ...prev };
      delete next[`${section}.${field}`];
      return next;
    });
  };

  const saveDraft = async () => {
    if (!enrolmentSessionHasMeaningfulData(values)) {
      toast.error('Enter at least your name or email before saving a draft.');
      return;
    }
    setBusy(true);
    try {
      const ensured = await ensureApplicationId();
      if (!ensured) return;
      const res = await saveEnrolmentDraft(ensured.id, values, ensured.files);
      if (res.ok) toast.success('Draft saved. You can return later to complete your application.');
      else toast.error(res.error ?? 'Could not save draft');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = handleSubmit(
    async (data) => {
    setFileErrors({});

    const fileChecks: { section: string; field: string; label: string }[] = [
      { section: 'vet', field: 'passport', label: 'Passport document' },
    ];
    if (data.vet.holdsAustralianVisa === 'Yes') {
      fileChecks.push({ section: 'vet', field: 'visa', label: 'Visa copy' });
    }
    if (data.courseCredit === 'Yes') {
      fileChecks.push({ section: 'credit', field: 'evidence', label: 'RPL / credit transfer evidence' });
    }
    if (data.oshc.requirement === 'Already Have') {
      fileChecks.push({ section: 'oshc', field: 'document', label: 'OSHC document' });
    }
    if (data.vet.englishAssessmentType.trim()) {
      fileChecks.push({ section: 'vet', field: 'english', label: 'English test results document' });
    }

    const missing = fileChecks.filter((f) => !hasFile(f.section, f.field));
    if (missing.length > 0) {
      const map: Record<string, string> = {};
      for (const m of missing) map[`${m.section}.${m.field}`] = `${m.label} is required`;
      setFileErrors(map);
      const uploadLines = missing.map((m) => `• ${m.label}`).join('\n');
      toast.error(
        missing.length === 1
          ? `Missing upload: ${missing[0].label}`
          : `Missing uploads:\n${uploadLines}`,
        ENROLMENT_VALIDATION_TOAST_MS
      );
      return;
    }

    setBusy(true);
    try {
      const ensured = await ensureApplicationId();
      if (!ensured) return;
      const { id, files } = ensured;
      const res = await submitEnrolmentApplication(
        id,
        data,
        files,
        data.vet.sendCopyToAgent && !!data.vet.agentEmail.trim()
      );
      if (!res.ok) {
        toast.error(res.error ?? 'Submit failed');
        return;
      }
      const courseLabels = data.course.courseIds.map(
        (cid) => courseOpts.find((c) => c.value === cid)?.label ?? cid
      );

      let deliveryNote: string | null = null;
      try {
        const pdfBlob = await generateEnrolmentPdfBlob(data, res.applicationNo ?? null, files, courseLabels);
        const pdfBase64 = await enrolmentPdfBlobToBase64(pdfBlob);
        const sendToAgent = Boolean(data.vet.sendCopyToAgent && data.vet.agentEmail.trim());
        const emailRes = await sendEnrolmentSubmissionEmails({
          applicationId: id,
          applicationNo: res.applicationNo ?? null,
          applicantEmail: data.personal.email.trim(),
          applicantName: [data.personal.firstName, data.personal.lastName].filter(Boolean).join(' ').trim(),
          agentEmail: sendToAgent ? data.vet.agentEmail.trim() : undefined,
          sendToAgent,
          pdfBase64,
          pdfFilename: enrolmentPdfFilename(res.applicationNo ?? null, data),
          fileRefs: attachmentFilesOnly(files),
        });
        if (emailRes.ok) {
          deliveryNote = emailRes.message ?? null;
        } else {
          deliveryNote = emailRes.error ?? 'Email could not be sent.';
          toast.error(emailRes.error ?? 'Application saved but email could not be sent. Contact admissions.');
        }
      } catch (emailErr) {
        deliveryNote = emailErr instanceof Error ? emailErr.message : 'Email could not be sent.';
        toast.error('Application saved but email could not be sent. Contact admissions.');
      }

      const snapshot: EnrolmentSubmittedCache = {
        applicationId: id,
        applicationNo: res.applicationNo ?? null,
        values: data,
        fileRefs: files,
        courseLabels,
        emailDeliveryNote: deliveryNote,
      };
      writeEnrolmentSubmitted(snapshot);
      setSubmittedSnapshot(snapshot);
      setEmailDeliveryNote(deliveryNote);
      clearEnrolmentSession();
      setApplicationNo(res.applicationNo ?? null);
      setSubmitted(true);
      toast.success(
        deliveryNote && !deliveryNote.toLowerCase().includes('could not')
          ? 'Application submitted. Check your email for your PDF and documents.'
          : 'Application submitted successfully.'
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  },
    (invalid) => {
      toast.error(formatEnrolmentValidationToast(invalid), ENROLMENT_VALIDATION_TOAST_MS);
      requestAnimationFrame(() => {
        const first =
          document.querySelector('.field-error') ??
          document.querySelector('[aria-invalid="true"]');
        first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  );

  const toggleDeclAll = (checked: boolean) => {
    for (const item of DECLARATION_ITEMS) {
      setValue(`declaration.items.${item.key}` as const, checked);
    }
  };

  const allDeclChecked = DECLARATION_ITEMS.every((d) => values.declaration.items[d.key]);

  if (submitted) {
    return (
      <div className="enrol-form min-h-screen">
        <div className="enrol-success-card">
          <SlitDocumentHeader className="mb-6" />
          <h1 className="page-title">Thank you</h1>
          <p className="intro">
            Your international student application has been submitted successfully.
            {applicationNo ? (
              <>
                {' '}
                Reference: <strong>{applicationNo}</strong>
              </>
            ) : null}
          </p>
          <p className="intro">The admissions team will contact you using the email address you provided.</p>
          {submittedSnapshot ? (
            <p className="intro">
              {emailDeliveryNote && !emailDeliveryNote.toLowerCase().includes('could not') ? (
                <>
                  We have emailed your <strong>application PDF</strong> and <strong>uploaded documents</strong> to{' '}
                  <strong>{submittedSnapshot.values.personal.email}</strong>
                  {submittedSnapshot.values.vet.sendCopyToAgent &&
                  submittedSnapshot.values.vet.agentEmail.trim() ? (
                    <>
                      . A copy was also sent to <strong>{submittedSnapshot.values.vet.agentEmail}</strong>.
                    </>
                  ) : (
                    '.'
                  )}
                </>
              ) : (
                <>
                  We could not send the confirmation email automatically
                  {emailDeliveryNote ? <> ({emailDeliveryNote})</> : null}. Please contact admissions if you do not
                  receive your documents shortly.
                </>
              )}
            </p>
          ) : (
            <p className="intro">
              Your application PDF and uploaded documents will be sent to the email address you provided.
            </p>
          )}
          <p className="intro text-sm text-slate-600 mt-4">Please do not reply to the confirmation email.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="enrol-form min-h-screen">
      <SlitDocumentHeader className="mb-6" />
      <h1 className="page-title">International Student&apos;s Application Form</h1>
      <p className="intro">
        Complete all sections below, attach required documents, and use an email address you check regularly. Your
        progress is saved automatically in this browser tab while it stays open (including after refresh). Use Save and
        Exit to also store a copy on our server.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <SectionHeading>1. Personal Details</SectionHeading>
        <div className="enrol-section">
          <SelectField label="Title" required register={register} name="personal.title" error={errors.personal?.title} options={TITLE_OPTIONS} />
          <TextField label="First Name" required register={register} name="personal.firstName" error={errors.personal?.firstName} />
          <TextField label="Middle Name (if applicable)" register={register} name="personal.middleName" />
          <TextField label="Last Name" required register={register} name="personal.lastName" error={errors.personal?.lastName} />
          <DateField
            label="Date of Birth"
            required
            value={values.personal.dateOfBirth}
            onChange={(v) => setValue('personal.dateOfBirth', v)}
            error={errors.personal?.dateOfBirth}
            fromYear={1950}
            toYear={new Date().getFullYear()}
            disableFuture
            placement="below"
          />
          <RadioGroup label="Gender" required name="gender" options={GENDER_OPTIONS} value={values.personal.gender} onChange={(v) => setValue('personal.gender', v)} error={errors.personal?.gender} />
          <PhoneField
            label="Mobile"
            required
            register={register}
            setValue={setValue}
            name="personal.mobile"
            error={errors.personal?.mobile}
            placeholder={values.address.type === 'australian' ? '0412345678' : '10 digits'}
          />
          <PhoneField
            label="Work / Overseas Phone Number"
            register={register}
            setValue={setValue}
            name="personal.workPhone"
            error={errors.personal?.workPhone}
            placeholder="Optional — 10 digits"
          />
          <div className="enrol-grid-2">
            <TextField label="Email" required register={register} name="personal.email" type="email" error={errors.personal?.email} />
            <TextField label="Confirm Email" required register={register} name="personal.confirmEmail" type="email" error={errors.personal?.confirmEmail} />
          </div>
          <p className="enrol-note caps">All communication will be done via email, so please provide an email that will be checked regularly.</p>
        </div>

        <SectionHeading>2. Address</SectionHeading>
        <div className="enrol-section">
          <RadioGroup
            label="Address type"
            required
            name="addressType"
            options={[
              { value: 'australian', label: 'Australian Address' },
              { value: 'overseas', label: 'Overseas Address' },
            ]}
            value={values.address.type}
            onChange={(v) => setValue('address.type', v as 'australian' | 'overseas')}
          />
          {values.address.type === 'australian' ? (
            <>
              <TextField
                label="Street Address"
                required
                register={register}
                name="address.australian.line1"
                error={errors.address?.australian?.line1}
              />
              <TextField label="Address Line 2" register={register} name="address.australian.line2" />
              <div className="enrol-grid-2">
                <TextField
                  label="Suburb"
                  required
                  register={register}
                  name="address.australian.suburb"
                  error={errors.address?.australian?.suburb}
                />
                <TextField
                  label="State"
                  required
                  register={register}
                  name="address.australian.state"
                  error={errors.address?.australian?.state}
                />
              </div>
              <div className="enrol-grid-2">
                <PostcodeField
                  label="ZIP / Postal Code"
                  required
                  register={register}
                  setValue={setValue}
                  name="address.australian.postcode"
                  error={errors.address?.australian?.postcode}
                  australian
                />
                <SelectField
                  label="Country"
                  required
                  register={register}
                  name="address.australian.country"
                  options={COUNTRY_OPTIONS}
                  error={errors.address?.australian?.country}
                />
              </div>
            </>
          ) : (
            <>
              <TextField
                label="Address"
                required
                register={register}
                name="address.overseas.line1"
                error={errors.address?.overseas?.line1}
              />
              <TextField label="Address Line 2" register={register} name="address.overseas.line2" />
              <div className="enrol-grid-2">
                <TextField
                  label="Suburb"
                  required
                  register={register}
                  name="address.overseas.suburb"
                  error={errors.address?.overseas?.suburb}
                />
                <TextField
                  label="State / Territory / Province / Region"
                  required
                  register={register}
                  name="address.overseas.state"
                  error={errors.address?.overseas?.state}
                />
              </div>
              <div className="enrol-grid-2">
                <PostcodeField
                  label="ZIP / Postal Code"
                  required
                  register={register}
                  setValue={setValue}
                  name="address.overseas.postcode"
                  error={errors.address?.overseas?.postcode}
                />
                <SelectField
                  label="Country"
                  required
                  register={register}
                  name="address.overseas.country"
                  options={COUNTRY_OPTIONS}
                  error={errors.address?.overseas?.country}
                />
              </div>
            </>
          )}
          <p className="enrol-note caps">
            Please notify Skyline Institute Of Technology of any changes of address or contact details while enrolled.
          </p>
        </div>

        <SectionHeading>3. Passport and Visa Details</SectionHeading>
        <div className="enrol-section">
          <RadioGroup label="Do you currently hold a valid Australian visa?" required name="visa" options={YES_NO_OPTIONS} value={values.vet.holdsAustralianVisa} onChange={(v) => setValue('vet.holdsAustralianVisa', v)} />
          {values.vet.holdsAustralianVisa === 'Yes' && (
            <AttachmentField
              label="Upload visa copy"
              required
              onPick={(file) => onFilePick('vet', 'visa', file)}
              onClear={() => clearAttachment('vet', 'visa')}
              fileName={attachmentInfo('vet', 'visa').name}
              uploaded={attachmentInfo('vet', 'visa').uploaded}
              error={fileErrors['vet.visa']}
              hint="Accepted: jpg, jpeg, png, gif, pdf. Max 15 MB."
            />
          )}
          <SelectField label="Country of Citizenship" required register={register} name="vet.countryOfCitizenship" options={COUNTRY_OPTIONS} error={errors.vet?.countryOfCitizenship} />
          <SelectField label="Nationality" required register={register} name="vet.nationality" options={COUNTRY_OPTIONS} error={errors.vet?.nationality} />
          <SelectField label="Country of Birth" required register={register} name="vet.countryOfBirth" options={COUNTRY_OPTIONS} error={errors.vet?.countryOfBirth} />
          <TextField label="Passport Number" required register={register} name="vet.passportNumber" error={errors.vet?.passportNumber} />
          <DateField
            label="Passport Expiry Date"
            required
            value={values.vet.passportExpiry}
            onChange={(v) => setValue('vet.passportExpiry', v)}
            error={errors.vet?.passportExpiry}
            minDate={new Date().toISOString().slice(0, 10)}
            fromYear={new Date().getFullYear()}
            toYear={new Date().getFullYear() + 20}
            placement="below"
          />
          <AttachmentField
            label="Submit copy of passport documents"
            required
            onPick={(file) => onFilePick('vet', 'passport', file)}
            onClear={() => clearAttachment('vet', 'passport')}
            fileName={attachmentInfo('vet', 'passport').name}
            uploaded={attachmentInfo('vet', 'passport').uploaded}
            error={fileErrors['vet.passport']}
            hint="Accepted: jpg, jpeg, png, gif, pdf. Max 5 MB."
          />
          <SelectField label="English assessment type" register={register} name="vet.englishAssessmentType" options={[{ value: '', label: 'Select' }, ...ENGLISH_ASSESSMENT_OPTIONS]} />
          {values.vet.englishAssessmentType === 'Others' && (
            <TextField label="Specify assessment type" register={register} name="vet.englishAssessmentOther" />
          )}
          <table className="enrol-table">
            <thead>
              <tr>
                <th>Assessment Type</th>
                <th>Overall</th>
                <th>L</th>
                <th>R</th>
                <th>W</th>
                <th>S</th>
              </tr>
            </thead>
            <tbody>
              {ENGLISH_PROFICIENCY_MAPPING.map((r) => (
                <tr key={r.type}>
                  <td>{r.type}</td>
                  <td>{r.overall}</td>
                  <td>{r.listening}</td>
                  <td>{r.reading}</td>
                  <td>{r.writing}</td>
                  <td>{r.speaking}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <TextField label="Score (individual & overall)" register={register} name="vet.englishScore" />
          <DateField
            label="Date achieved"
            value={values.vet.englishDateAchieved}
            onChange={(v) => setValue('vet.englishDateAchieved', v)}
            fromYear={1990}
            toYear={new Date().getFullYear()}
            disableFuture
            placement="below"
          />
          <AttachmentField
            label="Upload English results"
            onPick={(file) => onFilePick('vet', 'english', file)}
            onClear={() => clearAttachment('vet', 'english')}
            fileName={attachmentInfo('vet', 'english').name}
            uploaded={attachmentInfo('vet', 'english').uploaded}
            hint="Accepted: jpg, jpeg, png, gif, pdf. Max 15 MB."
          />
          <RadioGroup label="Is application submitted through an agent?" name="agent" options={YES_NO_OPTIONS} value={values.vet.throughAgent} onChange={(v) => setValue('vet.throughAgent', v)} />
          {values.vet.throughAgent === 'Yes' && (
            <>
              <TextField
                label="Agency & branch name"
                required
                register={register}
                name="vet.agencyBranchName"
                error={errors.vet?.agencyBranchName}
              />
              <TextField
                label="Agent name"
                required
                register={register}
                name="vet.agentName"
                error={errors.vet?.agentName}
              />
              <PhoneField
                label="Agent contact number"
                required
                register={register}
                setValue={setValue}
                name="vet.agentPhone"
                error={errors.vet?.agentPhone}
                placeholder="10 digits (AU from 0 or overseas)"
              />
              <TextField
                label="Agent email"
                required
                register={register}
                name="vet.agentEmail"
                type="email"
                error={errors.vet?.agentEmail}
              />
              <CheckOption>
                <input type="checkbox" {...register('vet.sendCopyToAgent')} />
                Send a copy via email to the agent
              </CheckOption>
            </>
          )}
        </div>

        <SectionHeading>4. Student Identifier (AVETMISS)</SectionHeading>
        <div className="enrol-section">
          <RadioGroup label="Aboriginal or Torres Strait Islander origin" required name="indigenous" options={INDIGENOUS_OPTIONS} value={values.studentIdentifier.indigenousOrigin} onChange={(v) => setValue('studentIdentifier.indigenousOrigin', v)} error={errors.studentIdentifier?.indigenousOrigin} />
          <SelectField label="Employment status" required register={register} name="studentIdentifier.employmentStatus" options={[{ value: '', label: 'Select' }, ...EMPLOYMENT_STATUS_OPTIONS]} error={errors.studentIdentifier?.employmentStatus} />
          <SelectField label="Language spoken at home" required register={register} name="studentIdentifier.languageAtHome" options={LANGUAGE_OPTIONS} error={errors.studentIdentifier?.languageAtHome} />
          {values.studentIdentifier.languageAtHome === 'Yes' && (
            <TextField label="Please specify language" register={register} name="studentIdentifier.languageSpecify" error={errors.studentIdentifier?.languageSpecify} />
          )}
          <RadioGroup label="Still enrolled in secondary or senior secondary education?" required name="secondary" options={YES_NO_OPTIONS} value={values.studentIdentifier.stillInSecondary} onChange={(v) => setValue('studentIdentifier.stillInSecondary', v)} />
          <SelectField label="Highest completed school level" required register={register} name="studentIdentifier.highestSchoolLevel" options={[{ value: '', label: 'Select' }, ...SCHOOL_LEVEL_OPTIONS]} />
          <YearField
            label="Year completed"
            value={values.studentIdentifier.yearCompleted}
            onChange={(v) => setValue('studentIdentifier.yearCompleted', v)}
            fromYear={1980}
            toYear={new Date().getFullYear()}
            allowNotSpecified
            placement="below"
          />
          <RadioGroup label="Prior education completed?" required name="priorEd" options={PRIOR_EDUCATION_OPTIONS} value={values.studentIdentifier.priorEducation} onChange={(v) => setValue('studentIdentifier.priorEducation', v)} />
          {values.studentIdentifier.priorEducation === 'Yes' && (
            <CheckboxGroup
              label="If yes, tick any applicable"
              options={PRIOR_EDUCATION_TYPE_OPTIONS}
              values={values.studentIdentifier.priorEducationTypes}
              onToggle={(val, on) => {
                const cur = values.studentIdentifier.priorEducationTypes;
                setValue('studentIdentifier.priorEducationTypes', on ? [...cur, val] : cur.filter((x) => x !== val));
              }}
            />
          )}
          <RadioGroup label="Disability" required name="disability" options={DISABILITY_OPTIONS} value={values.studentIdentifier.disability} onChange={(v) => setValue('studentIdentifier.disability', v)} />
          {values.studentIdentifier.disability === 'Yes' && (
            <>
              <SelectField label="Disability type" register={register} name="studentIdentifier.disabilityType" options={[{ value: '', label: 'Select' }, ...DISABILITY_TYPE_OPTIONS]} />
              <AttachmentField
                label="Upload supporting document (optional)"
                onPick={(file) => onFilePick('disability', 'document', file)}
                onClear={() => clearAttachment('disability', 'document')}
                fileName={attachmentInfo('disability', 'document').name}
                uploaded={attachmentInfo('disability', 'document').uploaded}
                hint="Accepted: jpg, jpeg, png, gif, pdf. Max 15 MB."
              />
            </>
          )}
        </div>

        <SectionHeading>5. Unique Student Identifier (USI)</SectionHeading>
        <div className="enrol-section">
          <p className="enrol-note">
            A USI is required for nationally recognised training. Apply at{' '}
            <a href="https://www.usi.gov.au/" target="_blank" rel="noreferrer" className="text-[#2563eb] underline">
              usi.gov.au
            </a>{' '}
            if you do not have one.
          </p>
          <RadioGroup label="Do you already have a USI?" required name="hasUsi" options={YES_NO_OPTIONS} value={values.usi.hasUsi} onChange={(v) => setValue('usi.hasUsi', v)} />
          {values.usi.hasUsi === 'Yes' && (
            <TextField label="USI number" required register={register} name="usi.usiNumber" error={errors.usi?.usiNumber} />
          )}
          {values.usi.hasUsi === 'No' && (
            <>
              <p className="enrol-note">
                Please apply for or obtain your USI prior to enrolment.
              </p>
              <a
                href="https://www.usi.gov.au/students/create-your-usi"
                target="_blank"
                rel="noreferrer"
                className="enrol-btn-outline inline-block mb-4 no-underline"
              >
                Apply for USI
              </a>
            </>
          )}
          <CheckOption>
            <input type="checkbox" {...register('usi.consent')} />
            I consent to SLIT using/providing my USI for enrolment, reporting and verification purposes where required.
          </CheckOption>
          <SignatureFieldRow
            label="Digital signature"
            required
            value={values.usi.signatureName?.trim() || null}
            onChange={(v) => setValue('usi.signatureName', v ?? '', { shouldValidate: true, shouldDirty: true })}
            error={errors.usi?.signatureName}
            suggestionFrom={
              [values.personal.firstName, values.personal.lastName].filter(Boolean).join(' ').trim() || null
            }
            onSuggestionClick={
              [values.personal.firstName, values.personal.lastName].filter(Boolean).join(' ').trim()
                ? () => {
                    const name = [values.personal.firstName, values.personal.lastName].filter(Boolean).join(' ').trim();
                    setValue('usi.signatureName', name, { shouldValidate: true, shouldDirty: true });
                  }
                : undefined
            }
          />
          <DateField
            label="Date"
            value={values.usi.signatureDate}
            onChange={(v) => setValue('usi.signatureDate', v)}
            fromYear={new Date().getFullYear() - 1}
            toYear={new Date().getFullYear() + 1}
            placement="below"
          />
        </div>

        <SectionHeading>6. Emergency Contact</SectionHeading>
        <div className="enrol-section">
          <TextField label="Full name" required register={register} name="emergency.fullName" error={errors.emergency?.fullName} />
          <TextField label="Relationship to you" register={register} name="emergency.relationship" />
          <TextField
            label="Email"
            register={register}
            name="emergency.email"
            type="email"
            error={errors.emergency?.email}
          />
          <PhoneField
            label="Contact number"
            required
            register={register}
            setValue={setValue}
            name="emergency.contactNumber"
            error={errors.emergency?.contactNumber}
            placeholder={values.emergency.inAustralia === 'Yes' ? '0412345678' : '10 digits'}
          />
          <RadioGroup label="Is your emergency contact in Australia?" required name="ecAus" options={YES_NO_OPTIONS} value={values.emergency.inAustralia} onChange={(v) => setValue('emergency.inAustralia', v)} />
        </div>

        <SectionHeading>7. Course Information</SectionHeading>
        <div className="enrol-section">
          <CheckboxGroup
            label="Which courses would you like to study?"
            options={courseOpts}
            values={values.course.courseIds}
            onToggle={(val, on) => {
              const cur = values.course.courseIds;
              setValue('course.courseIds', on ? [...cur, val] : cur.filter((x) => x !== val));
            }}
          />
          <FieldErrorMsg error={errors.course?.courseIds?.message} />
          <MonthYearField
            label="Preferred intake (MM/YYYY)"
            value={values.course.preferredIntake}
            onChange={(v) => setValue('course.preferredIntake', v)}
            placement="below"
          />
          <p className="enrol-note">
            Please contact admissions for intake dates and fees. SLIT cannot guarantee availability of your selected schedule.
          </p>
          <CheckboxGroup
            label="Course Preference Priority"
            options={PREFERENCE_CHOICE_OPTIONS}
            values={values.course.coursePreferencePriority}
            onToggle={(val, on) => {
              const cur = values.course.coursePreferencePriority;
              setValue('course.coursePreferencePriority', on ? [...cur, val] : cur.filter((x) => x !== val));
            }}
          />
          <CheckboxGroup
            label="Additional Preference Priority"
            options={PREFERENCE_CHOICE_OPTIONS}
            values={values.course.additionalPreferencePriority}
            onToggle={(val, on) => {
              const cur = values.course.additionalPreferencePriority;
              setValue('course.additionalPreferencePriority', on ? [...cur, val] : cur.filter((x) => x !== val));
            }}
          />
        </div>

        <SectionHeading>8. Study Reason</SectionHeading>
        <div className="enrol-section">
          <RadioGroup label="Main reason for undertaking this course" required name="studyReason" options={STUDY_REASON_OPTIONS} value={values.studyReason} onChange={(v) => setValue('studyReason', v)} error={errors.studyReason} />
        </div>

        <SectionHeading>9. Course Credit</SectionHeading>
        <div className="enrol-section">
          <RadioGroup label="Apply for RPL / credit transfer?" required name="credit" options={COURSE_CREDIT_OPTIONS} value={values.courseCredit} onChange={(v) => setValue('courseCredit', v)} />
          {values.courseCredit === 'Yes' && (
            <>
              <p className="enrol-note">Please attach prior qualifications / transcript.</p>
              <AttachmentField
                label="Upload evidence"
                required
                onPick={(file) => onFilePick('credit', 'evidence', file)}
                onClear={() => clearAttachment('credit', 'evidence')}
                fileName={attachmentInfo('credit', 'evidence').name}
                uploaded={attachmentInfo('credit', 'evidence').uploaded}
                error={fileErrors['credit.evidence']}
                hint="Accepted: jpg, jpeg, png, gif, pdf. Max 15 MB."
              />
            </>
          )}
        </div>

        <SectionHeading>10. OSHC / Health Insurance</SectionHeading>
        <div className="enrol-section">
          <SelectField label="Require SLIT to obtain OSHC on your behalf?" required register={register} name="oshc.requirement" options={[{ value: '', label: 'Select' }, ...OSHC_OPTIONS]} error={errors.oshc?.requirement} />
          {values.oshc.requirement === 'Yes' && (
            <SelectField label="Cover type" required register={register} name="oshc.coverType" options={[{ value: '', label: 'Select' }, ...OSHC_COVER_OPTIONS]} />
          )}
          {values.oshc.requirement === 'Already Have' && (
            <>
              <TextField label="Provider name" register={register} name="oshc.providerName" />
              <DateField
                label="Expiry date"
                value={values.oshc.expiryDate}
                onChange={(v) => setValue('oshc.expiryDate', v)}
                fromYear={new Date().getFullYear()}
                toYear={new Date().getFullYear() + 10}
                placement="below"
              />
              <AttachmentField
                label="Upload OSHC document"
                onPick={(file) => onFilePick('oshc', 'document', file)}
                onClear={() => clearAttachment('oshc', 'document')}
                fileName={attachmentInfo('oshc', 'document').name}
                uploaded={attachmentInfo('oshc', 'document').uploaded}
                error={fileErrors['oshc.document']}
                hint="Accepted: jpg, jpeg, png, gif, pdf. Max 15 MB."
              />
            </>
          )}
          {values.oshc.requirement === 'No' && (
            <CheckOption>
              <input type="checkbox" {...register('oshc.noOshcAck')} />
              I understand my OSHC obligations as an international student.
            </CheckOption>
          )}
        </div>

        <SectionHeading>11. How did you hear about SLIT?</SectionHeading>
        <div className="enrol-section">
          <SelectField label="Source" required register={register} name="hearAbout" options={[{ value: '', label: 'Select' }, ...HEAR_ABOUT_OPTIONS]} error={errors.hearAbout} />
        </div>

        <SectionHeading>12. Application Checklist</SectionHeading>
        <div className="enrol-section">
          <p className="enrol-note">
            Passport and English test documents are uploaded in section 3. Prior education is recorded in section 4.
            Transcript upload is only required in section 9 if you apply for RPL / credit transfer. Tick each item below
            that applies.
          </p>
          <div className="enrol-check-group">
            {requiredEnrolmentChecklistItems(values).map((item) => {
              const checklistErr = errors.checklist as Record<string, { message?: string }> | undefined;
              const itemErr = checklistErr?.[item.key];
              return (
                <div key={item.key}>
                  <CheckOption>
                    <input type="checkbox" {...register(`checklist.${item.key}`)} />
                    {item.label}
                  </CheckOption>
                  {itemErr?.message ? <p className="field-error">{itemErr.message}</p> : null}
                </div>
              );
            })}
          </div>
        </div>

        <SectionHeading>13. Student Declaration</SectionHeading>
        <div className="enrol-section">
          <p className="enrol-note">You must read SLIT terms and conditions before submitting.</p>
          <div className="enrol-check-group">
            <CheckOption>
              <input type="checkbox" checked={allDeclChecked} onChange={(e) => toggleDeclAll(e.target.checked)} />
              Select all
            </CheckOption>
            {DECLARATION_ITEMS.map((item) => (
              <CheckOption key={item.key}>
                <input type="checkbox" {...register(`declaration.items.${item.key}`)} />
                {item.label}
              </CheckOption>
            ))}
          </div>
          <TextField label="Full name of the person who made the declaration" required register={register} name="declaration.declarantName" error={errors.declaration?.declarantName} />
          <p className="enrol-note">Name only</p>
          <SignatureFieldRow
            label="Digital signature"
            required
            value={values.declaration.signatureName?.trim() || null}
            onChange={(v) => setValue('declaration.signatureName', v ?? '', { shouldValidate: true, shouldDirty: true })}
            error={errors.declaration?.signatureName}
            suggestionFrom={values.declaration.declarantName?.trim() || null}
            onSuggestionClick={
              values.declaration.declarantName?.trim()
                ? () => {
                    setValue('declaration.signatureName', values.declaration.declarantName.trim(), {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                  }
                : undefined
            }
          />
          <DateField
            label="Declaration date"
            required
            value={values.declaration.signatureDate}
            onChange={(v) => setValue('declaration.signatureDate', v)}
            error={errors.declaration?.signatureDate}
            fromYear={new Date().getFullYear() - 1}
            toYear={new Date().getFullYear() + 1}
            placement="below"
          />
        </div>

        <div className="enrol-actions">
          <button type="button" className="enrol-btn-outline" disabled={busy} onClick={() => void saveDraft()}>
            {busy ? 'Saving…' : 'Save and Exit'}
          </button>
          <button type="submit" className="enrol-btn-primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit Application'}
          </button>
        </div>
      </form>

      <ScrollToTopButton />
    </div>
  );
};
