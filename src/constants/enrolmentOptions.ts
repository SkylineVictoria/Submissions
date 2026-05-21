export const ENROLMENT_DRAFT_STORAGE_KEY = 'signflow.enrolment.applicationId';

export const TITLE_OPTIONS = [
  { value: '', label: 'Select' },
  { value: 'Mr', label: 'Mr' },
  { value: 'Miss', label: 'Miss' },
  { value: 'Ms', label: 'Ms' },
  { value: 'Mrs', label: 'Mrs' },
  { value: 'Dr', label: 'Dr' },
];

export const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];

export const YES_NO_OPTIONS = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
];

export const INDIGENOUS_OPTIONS = [
  { value: 'No', label: 'No' },
  { value: 'Yes, Aboriginal', label: 'Yes, Aboriginal' },
  { value: 'Yes, Torres Strait Islander', label: 'Yes, Torres Strait Islander' },
  {
    value: 'Yes, Aboriginal and Torres Strait Islander',
    label: 'Yes, Aboriginal and Torres Strait Islander',
  },
];

export const EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'Full-Time Employee - 01', label: 'Full-Time Employee - 01' },
  { value: 'Part-Time Employee - 02', label: 'Part-Time Employee - 02' },
  { value: 'Self-Employment Not Employing Others - 03', label: 'Self-Employment Not Employing Others - 03' },
  { value: 'Self employed – employing others - 04', label: 'Self employed – employing others - 04' },
  { value: 'Employed - Unpaid Worker in Family Business - 05', label: 'Employed - Unpaid Worker in Family Business - 05' },
  { value: 'Unemployed - Seeking Full-Time Work - 06', label: 'Unemployed - Seeking Full-Time Work - 06' },
  { value: 'Unemployed - Seeking Part-Time Work - 07', label: 'Unemployed - Seeking Part-Time Work - 07' },
  { value: 'Not Employed - Not Seeking Employment - 08', label: 'Not Employed - Not Seeking Employment - 08' },
];

export const LANGUAGE_OPTIONS = [
  { value: 'No, English only - 1201', label: 'No, English only - 1201' },
  { value: 'Yes', label: 'Yes, language other than English' },
];

export const SCHOOL_LEVEL_OPTIONS = [
  { value: 'Year 12 or equivalent - 12', label: 'Year 12 or equivalent - 12' },
  { value: 'Year 11 or equivalent - 11', label: 'Year 11 or equivalent - 11' },
  { value: 'Year 10 or equivalent - 10', label: 'Year 10 or equivalent - 10' },
  { value: 'Year 9 or equivalent - 09', label: 'Year 9 or equivalent - 09' },
  { value: 'Year 8 or below - 08', label: 'Year 8 or below - 08' },
  { value: 'Never attended school - 02', label: 'Never attended school - 02' },
];

export const PRIOR_EDUCATION_OPTIONS = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
  { value: 'Not specified', label: 'Not specified' },
];

export const PRIOR_EDUCATION_TYPE_OPTIONS = [
  { value: '008', label: 'Bachelor degree or higher degree - 008' },
  { value: '410', label: 'Advanced diploma or associate degree - 410' },
  { value: '420', label: 'Diploma or associate diploma - 420' },
  { value: '511', label: 'Certificate IV or advanced certificate/technician - 511' },
  { value: '514', label: 'Certificate III or trade certificate - 514' },
  { value: '521', label: 'Certificate II - 521' },
  { value: '524', label: 'Certificate I - 524' },
  {
    value: '990',
    label: 'Other education including certificates or overseas qualifications not listed above - 990',
  },
];

export const DISABILITY_OPTIONS = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
  { value: 'Not specified', label: 'Not specified' },
];

export const DISABILITY_TYPE_OPTIONS = [
  { value: '11', label: 'Hearing/deaf - 11' },
  { value: '12', label: 'Physical - 12' },
  { value: '13', label: 'Intellectual - 13' },
  { value: '14', label: 'Learning - 14' },
  { value: '15', label: 'Mental illness - 15' },
  { value: '16', label: 'Acquired brain impairment - 16' },
  { value: '17', label: 'Vision - 17' },
  { value: '18', label: 'Medical condition - 18' },
  { value: '19', label: 'Other - 19' },
];

export const ENGLISH_ASSESSMENT_OPTIONS = [
  { value: 'IELTS', label: 'IELTS' },
  { value: 'PTE', label: 'PTE' },
  { value: 'TOEFL', label: 'TOEFL' },
  { value: 'Others', label: 'Others (Please Specify)' },
];

export const STUDY_REASON_OPTIONS = [
  { value: '01', label: 'To get a job - 01' },
  { value: '02', label: 'To develop my existing business - 02' },
  { value: '03', label: 'To start my own business - 03' },
  { value: '04', label: 'To try for a different career - 04' },
  { value: '05', label: 'To get a better job or promotion - 05' },
  { value: '06', label: 'It was a requirement of my job - 06' },
  { value: '07', label: 'I wanted extra skills for my job - 07' },
  { value: '08', label: 'To get into another course of study - 08' },
  { value: '09', label: 'For personal interest or self-development - 09' },
  { value: '10', label: 'To get skills for community/voluntary work - 10' },
  { value: '11', label: 'Other reasons - 11' },
];

export const COURSE_CREDIT_OPTIONS = [
  { value: 'No', label: 'No' },
  { value: 'Yes', label: 'Yes' },
];

export const OSHC_OPTIONS = [
  { value: 'Yes', label: 'Yes' },
  { value: 'No', label: 'No' },
  { value: 'Already Have', label: 'Already Have' },
];

export const OSHC_COVER_OPTIONS = [
  { value: 'Single', label: 'Single' },
  { value: 'Couple', label: 'Couple' },
  { value: 'Family', label: 'Family' },
];

export const HEAR_ABOUT_OPTIONS = [
  { value: 'SLIT Website', label: 'SLIT Website' },
  { value: 'Agent', label: 'Agent' },
  { value: 'SLIT Student', label: 'SLIT Student' },
  { value: 'SLIT Staff Member', label: 'SLIT Staff Member' },
  { value: 'Family/Friend/Member', label: 'Family/Friend/Member' },
  { value: 'Others', label: 'Others' },
];

export const PREFERENCE_CHOICE_OPTIONS = [
  { value: 'First Choice', label: 'First Choice' },
  { value: 'Second Choice', label: 'Second Choice' },
  { value: 'Third Choice', label: 'Third Choice' },
];

export const FALLBACK_COURSE_OPTIONS = [
  { id: 'aur40216', label: 'AUR40216 - Certificate IV in Automotive Mechanical Diagnosis [112740K]' },
  { id: 'cpc30220', label: 'CPC30220 – Certificate III in Carpentry [119300M]' },
  { id: 'cpc30620', label: 'CPC30620 - Certificate III in Painting and Decorating [119299K]' },
  { id: 'cpc50220', label: 'CPC50220 – Diploma of Building and Construction (Building) [119301K]' },
  { id: 'msf30322', label: 'MSF30322 - Certificate III in Cabinet Making and Timber Technology' },
  { id: 'msf30422', label: 'MSF30422 - Certificate III in Glass and Glazing' },
  { id: 'rii50520', label: 'RII50520 - Diploma of Civil Construction Design [118122K]' },
  { id: 'rii60520', label: 'RII60520 - Advanced Diploma of Civil Construction Design [115521H]' },
  { id: 'bsb80120', label: 'BSB80120 - Graduate Diploma of Management (Learning) [113459C]' },
];

export const APPLICATION_CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: 'complete_sections', label: 'Complete all sections of the application form' },
  { key: 'credit_evidence', label: 'Attached evidence for credit or exemption' },
  { key: 'visa_oshc_details', label: 'Provide details if you already have student visa and/or OSHC' },
  // Prior education is captured in section 4 (AVETMISS). Transcript upload is only in section 9 when RPL/credit = Yes.
];

export const DECLARATION_ITEMS: { key: string; label: string }[] = [
  {
    key: 'decl_1',
    label:
      'I declare that the information submitted with this application is true and complete.',
  },
  {
    key: 'decl_2',
    label:
      'I acknowledge that failure to provide any document or disclose my academic record may result in SLIT revoking an offer or terminating my studies at any stage.',
  },
  {
    key: 'decl_3',
    label:
      'I authorise SLIT to seek verification of my academic and professional qualifications, and work experience. I understand that SLIT reserves the right to inform other tertiary institutions and regulatory agencies and right to cancel the enrolment if any of the material presented to support my application is found to be false',
  },
  {
    key: 'decl_4',
    label:
      'I understand that at the time of enrolment I will be required to supply originals of all documents used to support this application',
  },
  {
    key: 'decl_5',
    label:
      'I acknowledge that SLIT reserves the right to alter any course, subject, admission requirement or fee without prior notice.',
  },
  {
    key: 'decl_6',
    label:
      'I understand that the personal information I have provided may be released to government agencies as required by law.',
  },
  {
    key: 'decl_7',
    label:
      'I further understand that it may be disclosed to third parties for the purpose of this application. I also undertake to update about any address / contact detail change within 5 working days in writing to the college.',
  },
  {
    key: 'decl_8',
    label:
      'I acknowledge that I have read and understand the description of the courses(s) that I am applying for.',
  },
  {
    key: 'decl_9',
    label:
      'I agree to pay the applicable tuition fees prior to COE Issuance, term commencement and subsequent instalments of nominated studies set out on the letter of offer and I agree to be personally liable to the debt arising from fees owing. I understand that SLIT may seek the services of external debt collection agencies for the collection purpose. I will be liable to pay for any legal or linked charges for any such agencies',
  },
  {
    key: 'decl_10',
    label:
      'I have read and understand SLIT fees and refund policy and requirements as set out within the Student Handbook.',
  },
  {
    key: 'decl_11',
    label:
      'I authorised SLIT to access the Australian immigration Visa Entitlements Verification Online (VEVO) system at any time to obtain information on my visa status.',
  },
  {
    key: 'decl_12',
    label:
      'I declare that I am a genuine temporary entrant and genuine student and that I have read and understood conditions relating to requirements outlined on https://www.homeaffairs.gov.au',
  },
  {
    key: 'decl_13',
    label:
      'I am aware of the tuition and living costs of my stay in Australia and have the financial capacity to meet such costs for the duration of my course. I will make timely payments of any fees or associated costs.',
  },
  {
    key: 'decl_14',
    label:
      'I have read and understand the description of the ESOS framework made available at: https://internationaleducation.gov.au/regulatory-information/pages/regulatoryinformation.aspx',
  },
  {
    key: 'decl_15',
    label:
      'I declare that the information provided in this application and the documentation supporting it is true and complete',
  },
];

export const ENGLISH_PROFICIENCY_MAPPING = [
  { type: 'IELTS', overall: '6.0', listening: '5.5', reading: '5.5', writing: '5.5', speaking: '5.5' },
  { type: 'PTE', overall: '50', listening: '42', reading: '42', writing: '42', speaking: '42' },
  { type: 'TOEFL iBT', overall: '60', listening: '12', reading: '13', writing: '18', speaking: '16' },
];

export const COUNTRY_OPTIONS = [
  'Australia',
  'India',
  'China',
  'Nepal',
  'Philippines',
  'Vietnam',
  'Pakistan',
  'Bangladesh',
  'Sri Lanka',
  'Indonesia',
  'Malaysia',
  'Thailand',
  'Brazil',
  'Colombia',
  'United Kingdom',
  'United States',
  'Canada',
  'New Zealand',
  'South Korea',
  'Japan',
  'Other',
].map((c) => ({ value: c, label: c }));

export function buildYearCompletedOptions(): { value: string; label: string }[] {
  const y = new Date().getFullYear();
  const opts: { value: string; label: string }[] = [{ value: 'Not specified', label: 'Not specified' }];
  for (let i = y; i >= 1980; i--) opts.push({ value: String(i), label: String(i) });
  return opts;
}

export const FILE_SIZE_LIMITS = {
  passport: 5 * 1024 * 1024,
  default: 15 * 1024 * 1024,
} as const;

export const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];
