import { APPLICATION_CHECKLIST_ITEMS, DECLARATION_ITEMS } from '../constants/enrolmentOptions';
import type { EnrolmentFormValues } from '../types/enrolment';

const emptyAddress = () => ({
  line1: '',
  line2: '',
  suburb: '',
  state: '',
  postcode: '',
  country: 'Australia',
});

export function emptyEnrolmentFormValues(): EnrolmentFormValues {
  const checklist: Record<string, boolean> = {};
  for (const item of APPLICATION_CHECKLIST_ITEMS) checklist[item.key] = false;
  const declItems: Record<string, boolean> = {};
  for (const item of DECLARATION_ITEMS) declItems[item.key] = false;

  return {
    personal: {
      title: '',
      firstName: '',
      middleName: '',
      lastName: '',
      dateOfBirth: '',
      gender: '',
      mobile: '',
      workPhone: '',
      email: '',
      confirmEmail: '',
    },
    address: {
      type: 'australian',
      australian: emptyAddress(),
      overseas: { ...emptyAddress(), country: '' },
    },
    vet: {
      holdsAustralianVisa: '',
      countryOfCitizenship: '',
      nationality: '',
      countryOfBirth: '',
      passportNumber: '',
      passportExpiry: '',
      englishAssessmentType: '',
      englishAssessmentOther: '',
      englishScore: '',
      englishDateAchieved: '',
      throughAgent: '',
      agencyBranchName: '',
      agentName: '',
      agentPhone: '',
      agentEmail: '',
      sendCopyToAgent: false,
    },
    studentIdentifier: {
      indigenousOrigin: '',
      employmentStatus: '',
      languageAtHome: '',
      languageSpecify: '',
      stillInSecondary: '',
      highestSchoolLevel: '',
      yearCompleted: '',
      priorEducation: '',
      priorEducationTypes: [],
      disability: '',
      disabilityType: '',
    },
    usi: {
      hasUsi: '',
      usiNumber: '',
      consent: false,
      signatureName: '',
      signatureDate: new Date().toISOString().slice(0, 10),
    },
    emergency: {
      fullName: '',
      relationship: '',
      email: '',
      contactNumber: '',
      inAustralia: '',
    },
    course: {
      courseIds: [],
      preferredIntake: '',
      coursePreferencePriority: [],
      additionalPreferencePriority: [],
    },
    studyReason: '',
    courseCredit: 'No',
    oshc: {
      requirement: '',
      coverType: '',
      providerName: '',
      expiryDate: '',
      noOshcAck: false,
    },
    hearAbout: '',
    checklist,
    declaration: {
      items: declItems,
      declarantName: '',
      signatureName: '',
      signatureDate: new Date().toISOString().slice(0, 10),
    },
  };
}

export function mergeEnrolmentPayload(raw: unknown): EnrolmentFormValues {
  const base = emptyEnrolmentFormValues();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Partial<EnrolmentFormValues>;
  return {
    ...base,
    ...o,
    personal: { ...base.personal, ...(o.personal ?? {}) },
    address: {
      ...base.address,
      ...(o.address ?? {}),
      australian: { ...base.address.australian, ...(o.address?.australian ?? {}) },
      overseas: { ...base.address.overseas, ...(o.address?.overseas ?? {}) },
    },
    vet: { ...base.vet, ...(o.vet ?? {}) },
    studentIdentifier: { ...base.studentIdentifier, ...(o.studentIdentifier ?? {}) },
    usi: { ...base.usi, ...(o.usi ?? {}) },
    emergency: { ...base.emergency, ...(o.emergency ?? {}) },
    course: { ...base.course, ...(o.course ?? {}) },
    oshc: { ...base.oshc, ...(o.oshc ?? {}) },
    checklist: { ...base.checklist, ...(o.checklist ?? {}) },
    declaration: {
      ...base.declaration,
      ...(o.declaration ?? {}),
      items: { ...base.declaration.items, ...(o.declaration?.items ?? {}) },
    },
  };
}
