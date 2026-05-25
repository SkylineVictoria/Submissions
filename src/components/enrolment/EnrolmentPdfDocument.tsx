import React from 'react';
import { Document, Image, Link, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import {
  APPLICATION_CHECKLIST_ITEMS,
  DECLARATION_ITEMS,
  DISABILITY_OPTIONS,
  INDIGENOUS_OPTIONS,
  PRIOR_EDUCATION_OPTIONS,
  PRIOR_EDUCATION_TYPE_OPTIONS,
  STUDY_REASON_OPTIONS,
  YES_NO_OPTIONS,
} from '../../constants/enrolmentOptions';
import type { EnrolmentFileRef, EnrolmentFormValues } from '../../types/enrolment';

const BORDER = '#d1d5db';
const BORDER_DARK = '#9ca3af';

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#374151' },
  title: { fontSize: 14, fontWeight: 'bold', marginBottom: 4, color: '#ff7f11' },
  subtitle: { fontSize: 10, marginBottom: 12 },
  meta: { marginBottom: 8, lineHeight: 1.35 },
  section: { marginTop: 10, marginBottom: 4 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#ff7f11',
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  table: {
    width: '100%',
    borderWidth: 1,
    borderColor: BORDER_DARK,
    marginBottom: 6,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  labelCell: {
    width: '38%',
    padding: 6,
    borderRightWidth: 1,
    borderRightColor: BORDER,
    backgroundColor: '#f9fafb',
    fontWeight: 'bold',
    fontSize: 9,
  },
  valueCell: {
    width: '62%',
    padding: 6,
    fontSize: 9,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 5,
    paddingVertical: 2,
  },
  checkLabel: { flex: 1, fontSize: 9, lineHeight: 1.35, paddingLeft: 6 },
  checkboxBox: {
    width: 11,
    height: 11,
    borderWidth: 1,
    borderColor: '#6b7280',
    marginTop: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  radioCircle: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 1.5,
    borderColor: '#8A8A8A',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  radioInner: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#374151',
  },
  yesNoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  yesNoOption: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  yesNoOptionLabel: { fontSize: 9 },
  linkButton: {
    marginTop: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#2563eb',
    borderRadius: 4,
    alignSelf: 'flex-start',
    textDecoration: 'none',
  },
  linkButtonText: { color: '#ffffff', fontSize: 8, fontWeight: 'bold' },
  fileName: { fontSize: 8, color: '#6b7280', marginBottom: 2 },
});

function fileAt(fileRefs: EnrolmentFileRef[], section: string, field: string): EnrolmentFileRef | undefined {
  return fileRefs.find((f) => f.section === section && f.field === field);
}

function PdfCheckBox({ checked }: { checked: boolean }) {
  return (
    <View style={styles.checkboxBox}>
      {checked ? (
        <Svg width={9} height={9} viewBox="0 0 12 12">
          <Path
            d="M1.5 6.5 L4.5 9.5 L10.5 2.5"
            stroke="#111827"
            strokeWidth={1.8}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}
    </View>
  );
}

function PdfRadioDot({ selected }: { selected: boolean }) {
  return (
    <View style={styles.radioCircle}>
      {selected ? <View style={styles.radioInner} /> : null}
    </View>
  );
}

function BorderedRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.tableRow}>
      <Text style={styles.labelCell}>{label}</Text>
      <View style={styles.valueCell}>{children}</View>
    </View>
  );
}

function isImageSignature(value: string): boolean {
  return value.startsWith('data:image');
}

function TextRow({ label, value }: { label: string; value?: string | null }) {
  const v = value?.trim();
  if (!v) return null;
  return (
    <BorderedRow label={label}>
      <Text>{v}</Text>
    </BorderedRow>
  );
}

function SignatureRow({ label, value }: { label: string; value?: string | null }) {
  const v = value?.trim();
  if (!v) return null;
  return (
    <BorderedRow label={label}>
      {isImageSignature(v) ? (
        <Image src={v} style={{ height: 32, maxWidth: 180, objectFit: 'contain' }} />
      ) : (
        <Text style={{ color: '#dc2626', fontStyle: 'italic', fontFamily: 'Times-Roman' }}>{v}</Text>
      )}
    </BorderedRow>
  );
}

function YesNoRow({ label, value }: { label: string; value?: string | null }) {
  const v = value?.trim();
  if (!v) return null;
  return (
    <BorderedRow label={label}>
      <View style={styles.yesNoRow}>
        {YES_NO_OPTIONS.map((opt) => (
          <View key={opt.value} style={styles.yesNoOption}>
            <PdfRadioDot selected={v === opt.value} />
            <Text style={styles.yesNoOptionLabel}>{opt.label}</Text>
          </View>
        ))}
      </View>
    </BorderedRow>
  );
}

function RadioListRow({
  label,
  options,
  selected,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected?: string | null;
}) {
  const v = selected?.trim();
  if (!v) return null;
  return (
    <BorderedRow label={label}>
      <View>
        {options.map((opt) => (
          <View key={opt.value} style={styles.checkRow}>
            <PdfRadioDot selected={v === opt.value} />
            <Text style={styles.checkLabel}>{opt.label}</Text>
          </View>
        ))}
      </View>
    </BorderedRow>
  );
}

function CheckboxItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <View style={styles.checkRow}>
      <PdfCheckBox checked={checked} />
      <Text style={styles.checkLabel}>{label}</Text>
    </View>
  );
}

function AttachmentRow({
  label,
  file,
}: {
  label: string;
  file?: EnrolmentFileRef;
}) {
  return (
    <BorderedRow label={label}>
      {file ? (
        <View>
          <Text style={styles.fileName}>{file.name}</Text>
          <Link src={file.publicUrl} style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Open attachment</Text>
          </Link>
        </View>
      ) : (
        <Text>Not provided</Text>
      )}
    </BorderedRow>
  );
}

function AttachmentListRow({ label, files }: { label: string; files: EnrolmentFileRef[] }) {
  return (
    <BorderedRow label={label}>
      {files.length === 0 ? (
        <Text>Not provided</Text>
      ) : (
        <View>
          {files.map((file) => (
            <View key={file.path} style={{ marginBottom: 6 }}>
              <Text style={styles.fileName}>{file.name}</Text>
              <Link src={file.publicUrl} style={styles.linkButton}>
                <Text style={styles.linkButtonText}>Open attachment</Text>
              </Link>
            </View>
          ))}
        </View>
      )}
    </BorderedRow>
  );
}

function filesAt(fileRefs: EnrolmentFileRef[], section: string, field: string): EnrolmentFileRef[] {
  return fileRefs.filter((f) => f.section === section && f.field === field);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View wrap={false} minPresenceAhead={56}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.table}>{children}</View>
    </View>
  );
}

function formatAddress(values: EnrolmentFormValues): string {
  const a = values.address.type === 'australian' ? values.address.australian : values.address.overseas;
  return [a.line1, a.line2, a.suburb, a.state, a.postcode, a.country].filter(Boolean).join(', ');
}

export interface EnrolmentPdfDocumentProps {
  values: EnrolmentFormValues;
  applicationNo: string | null;
  fileRefs: EnrolmentFileRef[];
  courseLabels: string[];
}

export const EnrolmentPdfDocument: React.FC<EnrolmentPdfDocumentProps> = ({
  values,
  applicationNo,
  fileRefs,
  courseLabels,
}) => {
  const name = [values.personal.title, values.personal.firstName, values.personal.middleName, values.personal.lastName]
    .filter(Boolean)
    .join(' ');

  const passportFile = fileAt(fileRefs, 'vet', 'passport');
  const visaFile = fileAt(fileRefs, 'vet', 'visa');
  const visaDocuments = filesAt(fileRefs, 'vet', 'visa_documents');
  const academicDocuments = filesAt(fileRefs, 'academic', 'documents');
  const englishFile = fileAt(fileRefs, 'vet', 'english');
  const disabilityFile = fileAt(fileRefs, 'disability', 'document');
  const creditFile = fileAt(fileRefs, 'credit', 'evidence');
  const oshcFile = fileAt(fileRefs, 'oshc', 'document');
  const healthInsuranceFiles = filesAt(fileRefs, 'oshc', 'health_insurance');

  const logoSrc =
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/logo-text.png`
      : '/logo-text.png';

  return (
    <Document title="International Student Application">
      <Page size="A4" style={styles.page} wrap>
        <View style={{ alignItems: 'center', marginBottom: 10 }}>
          <Image src={logoSrc} style={{ height: 44, maxWidth: 200, objectFit: 'contain' }} />
        </View>
        <Text style={styles.title}>International Student&apos;s Application Form</Text>
        <Text style={styles.subtitle}>
          Skyline Institute of Technology
          {applicationNo ? ` — Reference: ${applicationNo}` : ''}
        </Text>
        <Text style={styles.meta}>
          Submitted: {new Date().toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })}
        </Text>

        <Section title="1. Personal Details">
          <TextRow label="Title" value={values.personal.title} />
          <TextRow label="Given name" value={values.personal.firstName} />
          <TextRow label="Middle name" value={values.personal.middleName} />
          <TextRow label="Surname" value={values.personal.lastName} />
          <TextRow label="Full name" value={name} />
          <TextRow label="Date of birth" value={values.personal.dateOfBirth} />
          <TextRow label="Gender" value={values.personal.gender} />
          <TextRow label="Mobile" value={values.personal.mobile} />
          <TextRow label="Work / overseas phone" value={values.personal.workPhone} />
          <TextRow label="Email" value={values.personal.email} />
        </Section>

        <Section title="2. Address">
          <TextRow label="Address type" value={values.address.type === 'australian' ? 'Australian' : 'Overseas'} />
          <TextRow label="Address" value={formatAddress(values)} />
        </Section>

        <Section title="3. Passport and Visa">
          <YesNoRow label="Valid Australian visa" value={values.vet.holdsAustralianVisa} />
          <AttachmentListRow label="Visa documents" files={visaDocuments} />
          {values.vet.holdsAustralianVisa === 'Yes' && (
            <AttachmentRow label="Visa copy" file={visaFile} />
          )}
          <TextRow label="Country of citizenship" value={values.vet.countryOfCitizenship} />
          <TextRow label="Nationality" value={values.vet.nationality} />
          <TextRow label="Country of birth" value={values.vet.countryOfBirth} />
          <TextRow label="Passport number" value={values.vet.passportNumber} />
          <TextRow label="Passport expiry" value={values.vet.passportExpiry} />
          <AttachmentRow label="Passport documents" file={passportFile} />
          <TextRow label="English assessment" value={values.vet.englishAssessmentType} />
          <TextRow label="English score" value={values.vet.englishScore} />
          <TextRow label="English date" value={values.vet.englishDateAchieved} />
          <AttachmentRow label="English results" file={englishFile} />
          <YesNoRow label="Submitted through agent" value={values.vet.throughAgent} />
          {values.vet.throughAgent === 'Yes' && (
            <>
              <TextRow label="Agency & branch" value={values.vet.agencyBranchName} />
              <TextRow label="Agent name" value={values.vet.agentName} />
              <TextRow label="Agent phone" value={values.vet.agentPhone} />
              <TextRow label="Agent email" value={values.vet.agentEmail} />
              <BorderedRow label="Send copy to agent">
                <CheckboxItem label="Send a copy via email to the agent" checked={!!values.vet.sendCopyToAgent} />
              </BorderedRow>
            </>
          )}
        </Section>

        <Section title="4. Student Identifier (AVETMISS)">
          <RadioListRow
            label="Indigenous origin"
            options={INDIGENOUS_OPTIONS}
            selected={values.studentIdentifier.indigenousOrigin}
          />
          <TextRow label="Employment status" value={values.studentIdentifier.employmentStatus} />
          <TextRow label="Language at home" value={values.studentIdentifier.languageAtHome} />
          <TextRow label="Language specified" value={values.studentIdentifier.languageSpecify} />
          <YesNoRow label="Still in secondary" value={values.studentIdentifier.stillInSecondary} />
          <TextRow label="Highest school level" value={values.studentIdentifier.highestSchoolLevel} />
          <TextRow label="Year completed" value={values.studentIdentifier.yearCompleted} />
          <RadioListRow
            label="Prior education"
            options={PRIOR_EDUCATION_OPTIONS}
            selected={values.studentIdentifier.priorEducation}
          />
          {values.studentIdentifier.priorEducation === 'Yes' && (
            <BorderedRow label="Prior qualifications">
              <View>
                {PRIOR_EDUCATION_TYPE_OPTIONS.map((opt) => (
                  <CheckboxItem
                    key={opt.value}
                    label={opt.label}
                    checked={values.studentIdentifier.priorEducationTypes.includes(opt.value)}
                  />
                ))}
              </View>
            </BorderedRow>
          )}
          <RadioListRow
            label="Disability"
            options={DISABILITY_OPTIONS}
            selected={values.studentIdentifier.disability}
          />
          <TextRow label="Disability type" value={values.studentIdentifier.disabilityType} />
          {values.studentIdentifier.disability === 'Yes' && (
            <AttachmentRow label="Disability support document" file={disabilityFile} />
          )}
        </Section>

        <Section title="4a. Academic documents">
          <AttachmentListRow label="Academic records" files={academicDocuments} />
        </Section>

        <Section title="5. USI">
          <YesNoRow label="Has USI" value={values.usi.hasUsi} />
          <TextRow label="USI number" value={values.usi.usiNumber} />
          <BorderedRow label="USI consent">
            <CheckboxItem
              label="I consent to SLIT using/providing my USI for enrolment, reporting and verification purposes where required."
              checked={!!values.usi.consent}
            />
          </BorderedRow>
          {/* Signature captured in declaration section only */}
        </Section>

        <Section title="6. Emergency Contact">
          <TextRow label="Full name" value={values.emergency.fullName} />
          <TextRow label="Relationship" value={values.emergency.relationship} />
          <TextRow label="Email" value={values.emergency.email} />
          <TextRow label="Contact number" value={values.emergency.contactNumber} />
          <YesNoRow label="In Australia" value={values.emergency.inAustralia} />
        </Section>

        <Section title="7. Course Information">
          <BorderedRow label="Courses">
            <View>
              {courseLabels.length === 0 ? (
                <Text>—</Text>
              ) : (
                courseLabels.map((label) => (
                  <CheckboxItem key={label} label={label} checked />
                ))
              )}
            </View>
          </BorderedRow>
          <TextRow label="Preferred intake" value={values.course.preferredIntake} />
        </Section>

        <Section title="8. Study Reason">
          <RadioListRow
            label="Reason"
            options={STUDY_REASON_OPTIONS}
            selected={values.studyReason}
          />
        </Section>

        <Section title="9. Course Credit">
          <YesNoRow label="RPL / credit transfer" value={values.courseCredit} />
          {values.courseCredit === 'Yes' && (
            <AttachmentRow label="RPL / credit evidence" file={creditFile} />
          )}
        </Section>

        <Section title="10. OSHC / Health insurance">
          <AttachmentListRow label="Health insurance documents" files={healthInsuranceFiles} />
          <TextRow label="OSHC requirement" value={values.oshc.requirement} />
          <TextRow label="Cover type" value={values.oshc.coverType} />
          <TextRow label="Provider" value={values.oshc.providerName} />
          <TextRow label="Expiry" value={values.oshc.expiryDate} />
          {values.oshc.requirement === 'Already Have' && (
            <AttachmentRow label="OSHC document" file={oshcFile} />
          )}
          {values.oshc.requirement === 'No' && (
            <BorderedRow label="OSHC acknowledgement">
              <CheckboxItem
                label="I understand my OSHC obligations as an international student."
                checked={!!values.oshc.noOshcAck}
              />
            </BorderedRow>
          )}
        </Section>

        <Section title="11. How did you hear about SLIT?">
          <TextRow label="Source" value={values.hearAbout} />
        </Section>

        <Section title="12. Application Checklist">
          <BorderedRow label="Checklist">
            <View>
              {APPLICATION_CHECKLIST_ITEMS.map((item) => (
                <CheckboxItem
                  key={item.key}
                  label={item.label}
                  checked={!!values.checklist[item.key]}
                />
              ))}
            </View>
          </BorderedRow>
        </Section>

        <Section title="13. Student Declaration">
          <BorderedRow label="Declarations">
            <View>
              {DECLARATION_ITEMS.map((item) => (
                <CheckboxItem
                  key={item.key}
                  label={item.label}
                  checked={!!values.declaration.items[item.key]}
                />
              ))}
            </View>
          </BorderedRow>
          <TextRow label="Declarant name" value={values.declaration.declarantName} />
          <SignatureRow label="Signature" value={values.declaration.signatureName} />
          <TextRow label="Date" value={values.declaration.signatureDate} />
        </Section>
      </Page>
    </Document>
  );
};
