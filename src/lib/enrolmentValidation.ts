import { z } from 'zod';
import { APPLICATION_CHECKLIST_ITEMS, DECLARATION_ITEMS } from '../constants/enrolmentOptions';
import type { EnrolmentAddressFields, EnrolmentAddressType } from '../types/enrolment';

const req = (msg: string) => z.string().trim().min(1, msg);

export const ENROLMENT_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export type PhoneLocale = 'australian' | 'overseas';

/** Strip to digits only (for input sanitisation). */
export function digitsOnlyPhone(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidEnrolmentEmail(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return ENROLMENT_EMAIL_REGEX.test(v);
}

/** Australian: 10 digits, must start with 0. Overseas: exactly 10 digits. */
export function validateEnrolmentPhone(
  value: string,
  locale: PhoneLocale,
  { required = true }: { required?: boolean } = {}
): { ok: true } | { ok: false; message: string } {
  const digits = digitsOnlyPhone(value);
  if (!digits) {
    return required ? { ok: false, message: 'Phone number is required' } : { ok: true };
  }
  if (locale === 'australian') {
    if (!digits.startsWith('0')) {
      return { ok: false, message: 'Australian phone must start with 0' };
    }
    if (digits.length !== 10) {
      return { ok: false, message: 'Australian phone must be 10 digits (e.g. 0412345678)' };
    }
    return { ok: true };
  }
  if (digits.length !== 10) {
    return { ok: false, message: 'Overseas phone must be exactly 10 digits' };
  }
  return { ok: true };
}

/** Agent / work phone: digits only; Australian or overseas 10-digit format. */
export function validateEnrolmentPhoneEither(
  value: string,
  { required = true }: { required?: boolean } = {}
): { ok: true } | { ok: false; message: string } {
  const digits = digitsOnlyPhone(value);
  if (!digits) {
    return required ? { ok: false, message: 'Phone number is required' } : { ok: true };
  }
  const au = validateEnrolmentPhone(digits, 'australian', { required: true });
  if (au.ok) return au;
  const os = validateEnrolmentPhone(digits, 'overseas', { required: true });
  if (os.ok) return os;
  return {
    ok: false,
    message: 'Enter 10 digits (Australian numbers start with 0, overseas numbers are 10 digits)',
  };
}

const reqEmail = (label: string) =>
  req(`${label} is required`).refine((v) => isValidEnrolmentEmail(v), 'Enter a valid email');

const optionalEmail = z
  .string()
  .trim()
  .refine((v) => !v || isValidEnrolmentEmail(v), 'Enter a valid email');

const addressFieldsSchema = z.object({
  line1: z.string(),
  line2: z.string(),
  suburb: z.string(),
  state: z.string(),
  postcode: z.string(),
  country: z.string(),
});

export const enrolmentDraftSchema = z.object({
  personal: z.object({
    title: z.string(),
    firstName: z.string(),
    middleName: z.string(),
    lastName: z.string(),
    dateOfBirth: z.string(),
    gender: z.string(),
    mobile: z.string(),
    workPhone: z.string(),
    email: z.string(),
    confirmEmail: z.string(),
  }),
});

export const enrolmentSubmitSchema = z
  .object({
    personal: z.object({
      title: req('Title is required'),
      firstName: req('First name is required'),
      middleName: z.string(),
      lastName: req('Last name is required'),
      dateOfBirth: req('Date of birth is required'),
      gender: req('Gender is required'),
      mobile: req('Mobile is required'),
      workPhone: z.string(),
      email: reqEmail('Email'),
      confirmEmail: reqEmail('Confirm email'),
    }),
    address: z.object({
      type: z.enum(['australian', 'overseas']),
      australian: addressFieldsSchema,
      overseas: addressFieldsSchema,
    }),
    vet: z.object({
      holdsAustralianVisa: req('Please select if you hold a valid Australian visa'),
      countryOfCitizenship: req('Country of citizenship is required'),
      nationality: req('Nationality is required'),
      countryOfBirth: req('Country of birth is required'),
      passportNumber: req('Passport number is required'),
      passportExpiry: req('Passport expiry date is required'),
      englishAssessmentType: z.string(),
      englishAssessmentOther: z.string(),
      englishScore: z.string(),
      englishDateAchieved: z.string(),
      throughAgent: z.string(),
      agencyBranchName: z.string(),
      agentName: z.string(),
      agentPhone: z.string(),
      agentEmail: z.string(),
      sendCopyToAgent: z.boolean(),
    }),
    studentIdentifier: z.object({
      indigenousOrigin: req('Please select Aboriginal or Torres Strait Islander origin'),
      employmentStatus: req('Employment status is required'),
      languageAtHome: req('Language at home is required'),
      languageSpecify: z.string(),
      stillInSecondary: req('Please answer if still enrolled in secondary education'),
      highestSchoolLevel: req('Highest completed school level is required'),
      yearCompleted: z.string(),
      priorEducation: req('Prior education is required'),
      priorEducationTypes: z.array(z.string()),
      disability: req('Disability status is required'),
      disabilityType: z.string(),
    }),
    usi: z.object({
      hasUsi: req('Please indicate if you have a USI'),
      usiNumber: z.string(),
      consent: z.boolean(),
      signatureName: z.string(),
      signatureDate: z.string(),
    }),
    emergency: z.object({
      fullName: req('Emergency contact full name is required'),
      relationship: z.string(),
      email: optionalEmail,
      contactNumber: req('Emergency contact number is required'),
      inAustralia: req('Please indicate if emergency contact is in Australia'),
    }),
    course: z.object({
      courseIds: z.array(z.string()).min(1, 'Select at least one course'),
      preferredIntake: z.string(),
      coursePreferencePriority: z.array(z.string()),
      additionalPreferencePriority: z.array(z.string()),
    }),
    studyReason: req('Study reason is required'),
    courseCredit: req('Course credit selection is required'),
    oshc: z.object({
      requirement: req('OSHC selection is required'),
      coverType: z.string(),
      providerName: z.string(),
      expiryDate: z.string(),
      noOshcAck: z.boolean(),
    }),
    hearAbout: req('Please tell us how you heard about SLIT'),
    checklist: z.record(z.string(), z.boolean()),
    declaration: z.object({
      items: z.record(z.string(), z.boolean()),
      declarantName: req('Declaration full name is required'),
      signatureName: req('Digital signature is required'),
      signatureDate: req('Declaration date is required'),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.personal.email.trim().toLowerCase() !== data.personal.confirmEmail.trim().toLowerCase()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Email and confirm email must match',
        path: ['personal', 'confirmEmail'],
      });
    }

    const phoneLocale: PhoneLocale = data.address.type === 'australian' ? 'australian' : 'overseas';

    const mobileCheck = validateEnrolmentPhone(data.personal.mobile, phoneLocale);
    if (!mobileCheck.ok) {
      ctx.addIssue({ code: 'custom', message: mobileCheck.message, path: ['personal', 'mobile'] });
    }

    // Work / overseas phone: optional; always overseas format (10 digits, does not need to start with 0).
    const workCheck = validateEnrolmentPhone(data.personal.workPhone, 'overseas', { required: false });
    if (!workCheck.ok) {
      ctx.addIssue({ code: 'custom', message: workCheck.message, path: ['personal', 'workPhone'] });
    }

    validateAddressFields(
      data.address.type === 'australian' ? data.address.australian : data.address.overseas,
      data.address.type,
      ctx,
      ['address', data.address.type]
    );

    const emergencyLocale: PhoneLocale = data.emergency.inAustralia === 'Yes' ? 'australian' : 'overseas';
    const ecCheck = validateEnrolmentPhone(data.emergency.contactNumber, emergencyLocale);
    if (!ecCheck.ok) {
      ctx.addIssue({ code: 'custom', message: ecCheck.message, path: ['emergency', 'contactNumber'] });
    }

    if (data.vet.passportExpiry) {
      const exp = new Date(data.vet.passportExpiry);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (Number.isNaN(exp.getTime()) || exp <= today) {
        ctx.addIssue({
          code: 'custom',
          message: 'Passport expiry must be a future date',
          path: ['vet', 'passportExpiry'],
        });
      }
    }

    if (data.studentIdentifier.languageAtHome === 'Yes' && !data.studentIdentifier.languageSpecify.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Please specify language',
        path: ['studentIdentifier', 'languageSpecify'],
      });
    }

    if (data.studentIdentifier.priorEducation === 'Yes' && data.studentIdentifier.priorEducationTypes.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select at least one prior qualification',
        path: ['studentIdentifier', 'priorEducationTypes'],
      });
    }

    if (data.usi.hasUsi === 'Yes' && !data.usi.usiNumber.trim()) {
      ctx.addIssue({ code: 'custom', message: 'USI number is required', path: ['usi', 'usiNumber'] });
    }
    if (!data.usi.consent) {
      ctx.addIssue({ code: 'custom', message: 'USI consent is required', path: ['usi', 'consent'] });
    }
    // USI signature pad removed — signature is captured once in the declaration section only.

    if (data.oshc.requirement === 'Yes' && !data.oshc.coverType.trim()) {
      ctx.addIssue({ code: 'custom', message: 'OSHC cover type is required', path: ['oshc', 'coverType'] });
    }
    if (data.oshc.requirement === 'No' && !data.oshc.noOshcAck) {
      ctx.addIssue({
        code: 'custom',
        message: 'Please acknowledge OSHC obligations',
        path: ['oshc', 'noOshcAck'],
      });
    }

    const agentFieldsRequired = data.vet.throughAgent === 'Yes' || data.hearAbout === 'Agent';
    if (agentFieldsRequired) {
      if (!data.vet.agencyBranchName.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'Agency & branch name is required',
          path: ['vet', 'agencyBranchName'],
        });
      }
      if (!data.vet.agentName.trim()) {
        ctx.addIssue({ code: 'custom', message: 'Agent name is required', path: ['vet', 'agentName'] });
      }
      const agentPhoneCheck = validateEnrolmentPhoneEither(data.vet.agentPhone);
      if (!agentPhoneCheck.ok) {
        ctx.addIssue({ code: 'custom', message: agentPhoneCheck.message, path: ['vet', 'agentPhone'] });
      }
      if (!data.vet.agentEmail.trim()) {
        ctx.addIssue({ code: 'custom', message: 'Agent email is required', path: ['vet', 'agentEmail'] });
      } else if (!isValidEnrolmentEmail(data.vet.agentEmail)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter a valid agent email',
          path: ['vet', 'agentEmail'],
        });
      }
    }

    for (const item of APPLICATION_CHECKLIST_ITEMS) {
      if (!isEnrolmentChecklistItemRequired(data, item.key)) continue;
      if (!data.checklist[item.key]) {
        ctx.addIssue({
          code: 'custom',
          message: `Checklist: ${item.label}`,
          path: ['checklist', item.key],
        });
      }
    }

    for (const item of DECLARATION_ITEMS) {
      if (!data.declaration.items[item.key]) {
        ctx.addIssue({
          code: 'custom',
          message: `Declaration required: ${item.label.slice(0, 60)}…`,
          path: ['declaration', 'items', item.key],
        });
      }
    }
  });

function validateAddressFields(
  addr: EnrolmentAddressFields,
  type: EnrolmentAddressType,
  ctx: z.RefinementCtx,
  basePath: (string | number)[]
): void {
  if (!addr.line1.trim()) {
    ctx.addIssue({
      code: 'custom',
      message: type === 'australian' ? 'Street address is required' : 'Address is required',
      path: [...basePath, 'line1'],
    });
  }
  if (!addr.suburb.trim()) {
    ctx.addIssue({
      code: 'custom',
      message: 'Suburb / city is required',
      path: [...basePath, 'suburb'],
    });
  }
  if (!addr.state.trim()) {
    ctx.addIssue({
      code: 'custom',
      message: type === 'australian' ? 'State is required' : 'State / region is required',
      path: [...basePath, 'state'],
    });
  }
  const postcodeDigits = digitsOnlyPhone(addr.postcode);
  if (!addr.postcode.trim()) {
    ctx.addIssue({
      code: 'custom',
      message: 'Postcode is required',
      path: [...basePath, 'postcode'],
    });
  } else if (type === 'australian' && postcodeDigits.length !== 4) {
    ctx.addIssue({
      code: 'custom',
      message: 'Australian postcode must be 4 digits',
      path: [...basePath, 'postcode'],
    });
  }
  if (!addr.country.trim()) {
    ctx.addIssue({
      code: 'custom',
      message: 'Country is required',
      path: [...basePath, 'country'],
    });
  }
}

export type EnrolmentSubmitValues = z.infer<typeof enrolmentSubmitSchema>;

type EnrolmentChecklistContext = Pick<EnrolmentSubmitValues, 'courseCredit' | 'vet' | 'oshc'>;

/** Whether a checklist acknowledgement applies for the current answers. */
export function isEnrolmentChecklistItemRequired(data: EnrolmentChecklistContext, key: string): boolean {
  switch (key) {
    case 'credit_evidence':
      return data.courseCredit === 'Yes';
    case 'visa_oshc_details':
      return data.vet.holdsAustralianVisa === 'Yes' || data.oshc.requirement === 'Already Have';
    default:
      return true;
  }
}

export function requiredEnrolmentChecklistItems(data: EnrolmentChecklistContext) {
  return APPLICATION_CHECKLIST_ITEMS.filter((item) => isEnrolmentChecklistItemRequired(data, item.key));
}

const RHF_ERROR_SKIP_KEYS = new Set(['ref', 'types', 'root', 'type']);

/** Collect unique validation messages from react-hook-form errors (zod messages are field-specific). */
export function collectEnrolmentValidationMessages(errors: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visited = new WeakSet<object>();

  const walk = (node: unknown): void => {
    if (node == null || typeof node !== 'object') return;

    if (visited.has(node)) return;
    visited.add(node);

    // FieldError leaf — do not recurse into ref (DOM nodes can be circular).
    if ('message' in node) {
      const raw = (node as { message?: unknown }).message;
      if (typeof raw === 'string') {
        const msg = raw.trim();
        if (msg && !seen.has(msg)) {
          seen.add(msg);
          out.push(msg);
        }
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (RHF_ERROR_SKIP_KEYS.has(key)) continue;
      walk(value);
    }
  };

  walk(errors);
  return out;
}

/** User-facing toast when submit validation fails (multiline; shown top-right). */
export function formatEnrolmentValidationToast(errors: unknown): string {
  const messages = collectEnrolmentValidationMessages(errors);
  if (messages.length === 0) {
    return 'Please complete all required fields before submitting.';
  }
  if (messages.length === 1) {
    return messages[0]!;
  }
  const max = 10;
  const lines = messages.slice(0, max).map((m) => `• ${m}`);
  if (messages.length > max) {
    lines.push(`• …and ${messages.length - max} more`);
  }
  return `Please complete the following:\n${lines.join('\n')}`;
}

/** Longer display for validation lists in the toast (top-right). */
export const ENROLMENT_VALIDATION_TOAST_MS = 12000;
