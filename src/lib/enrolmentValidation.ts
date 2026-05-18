import { z } from 'zod';
import { APPLICATION_CHECKLIST_ITEMS, DECLARATION_ITEMS } from '../constants/enrolmentOptions';

const req = (msg: string) => z.string().trim().min(1, msg);

const addressSchema = z.object({
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
      email: req('Email is required').email('Enter a valid email'),
      confirmEmail: req('Confirm email is required'),
    }),
    address: z.object({
      type: z.enum(['australian', 'overseas']),
      australian: addressSchema,
      overseas: addressSchema,
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
      email: z.string(),
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
      signatureName: req('Digital signature (typed name) is required'),
      signatureDate: req('Declaration date is required'),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.personal.email !== data.personal.confirmEmail) {
      ctx.addIssue({
        code: 'custom',
        message: 'Email and confirm email must match',
        path: ['personal', 'confirmEmail'],
      });
    }

    const addr = data.address.type === 'australian' ? data.address.australian : data.address.overseas;
    if (!addr.line1.trim()) {
      ctx.addIssue({ code: 'custom', message: 'Address is required', path: ['address', data.address.type, 'line1'] });
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
    if (!data.usi.signatureName.trim()) {
      ctx.addIssue({ code: 'custom', message: 'USI signature name is required', path: ['usi', 'signatureName'] });
    }

    if (data.courseCredit === 'Yes') {
      /* file validated separately */
    }

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
      if (!data.vet.agentPhone.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'Agent contact number is required',
          path: ['vet', 'agentPhone'],
        });
      }
      if (!data.vet.agentEmail.trim()) {
        ctx.addIssue({ code: 'custom', message: 'Agent email is required', path: ['vet', 'agentEmail'] });
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.vet.agentEmail.trim())) {
        ctx.addIssue({
          code: 'custom',
          message: 'Enter a valid agent email',
          path: ['vet', 'agentEmail'],
        });
      }
    }

    for (const item of APPLICATION_CHECKLIST_ITEMS) {
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

export type EnrolmentSubmitValues = z.infer<typeof enrolmentSubmitSchema>;
