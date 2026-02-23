import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Role, SignatureData, FormState } from '../types';

interface FormStore extends FormState {
  setRole: (role: Role) => void;
  updateAnswer: (fieldId: string, value: any) => void;
  setStudentSignature: (signature: SignatureData) => void;
  setTrainerSignature: (signature: SignatureData) => void;
  setStudentSubmitted: (submitted: boolean) => void;
  setTrainerSubmitted: (submitted: boolean) => void;
  resetForm: () => void;
}

const initialSignature: SignatureData = {
  imageDataUrl: null,
  typedText: null,
  signedAtDate: null,
};

const initialState: FormState = {
  role: 'student',
  studentSignature: initialSignature,
  trainerSignature: initialSignature,
  answers: {},
  studentSubmitted: false,
  trainerSubmitted: false,
};

export const useFormStore = create<FormStore>()(
  persist(
    (set) => ({
      ...initialState,
      setRole: (role) => set({ role }),
      updateAnswer: (fieldId, value) =>
        set((state) => ({
          answers: { ...state.answers, [fieldId]: value },
        })),
      setStudentSignature: (signature) => set({ studentSignature: signature }),
      setTrainerSignature: (signature) => set({ trainerSignature: signature }),
      setStudentSubmitted: (submitted) => set({ studentSubmitted: submitted }),
      setTrainerSubmitted: (submitted) => set({ trainerSubmitted: submitted }),
      resetForm: () => set(initialState),
    }),
    {
      name: 'form-storage',
    }
  )
);

