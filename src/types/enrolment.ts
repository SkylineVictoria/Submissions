/** International student enrolment application — stored in student_enrolment_applications.payload / files */

export type EnrolmentAddressType = 'australian' | 'overseas';

export interface EnrolmentAddressFields {
  line1: string;
  line2: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
}

export interface EnrolmentFileRef {
  section: string;
  field: string;
  path: string;
  publicUrl: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface EnrolmentFormValues {
  personal: {
    title: string;
    firstName: string;
    middleName: string;
    lastName: string;
    dateOfBirth: string;
    gender: string;
    mobile: string;
    workPhone: string;
    email: string;
    confirmEmail: string;
  };
  address: {
    type: EnrolmentAddressType;
    australian: EnrolmentAddressFields;
    overseas: EnrolmentAddressFields;
  };
  vet: {
    holdsAustralianVisa: string;
    countryOfCitizenship: string;
    nationality: string;
    countryOfBirth: string;
    passportNumber: string;
    passportExpiry: string;
    englishAssessmentType: string;
    englishAssessmentOther: string;
    englishScore: string;
    englishDateAchieved: string;
    throughAgent: string;
    agencyBranchName: string;
    agentName: string;
    agentPhone: string;
    agentEmail: string;
    sendCopyToAgent: boolean;
  };
  studentIdentifier: {
    indigenousOrigin: string;
    employmentStatus: string;
    languageAtHome: string;
    languageSpecify: string;
    stillInSecondary: string;
    highestSchoolLevel: string;
    yearCompleted: string;
    priorEducation: string;
    priorEducationTypes: string[];
    disability: string;
    disabilityType: string;
  };
  usi: {
    hasUsi: string;
    usiNumber: string;
    consent: boolean;
    signatureName: string;
    signatureDate: string;
  };
  emergency: {
    fullName: string;
    relationship: string;
    email: string;
    contactNumber: string;
    inAustralia: string;
  };
  course: {
    courseIds: string[];
    preferredIntake: string;
    coursePreferencePriority: string[];
    additionalPreferencePriority: string[];
  };
  studyReason: string;
  courseCredit: string;
  oshc: {
    requirement: string;
    coverType: string;
    providerName: string;
    expiryDate: string;
    noOshcAck: boolean;
  };
  hearAbout: string;
  checklist: Record<string, boolean>;
  declaration: {
    items: Record<string, boolean>;
    declarantName: string;
    signatureName: string;
    signatureDate: string;
  };
}

export interface StudentEnrolmentApplicationRow {
  id: string;
  application_no: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_mobile: string | null;
  payload: EnrolmentFormValues;
  files: EnrolmentFileRef[];
  agent_copy_sent: boolean;
}
