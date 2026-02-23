export type Role = 'student' | 'trainer' | 'office';

export type RoleScope = 'student' | 'trainer' | 'both' | 'office';

export interface SignatureData {
  imageDataUrl: string | null;
  /** Typed name used as signature (displayed as red italic). Optional for backwards compat with persisted state. */
  typedText?: string | null;
  signedAtDate: string | null;
}

export interface FormAnswers {
  [fieldId: string]: any;
}

export interface FormState {
  role: Role;
  studentSignature: SignatureData;
  trainerSignature: SignatureData;
  answers: FormAnswers;
  studentSubmitted: boolean;
  trainerSubmitted: boolean;
}

