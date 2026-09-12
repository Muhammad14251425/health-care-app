/**
 * Public booking wizard state.
 *
 * Zustand holds only the user's in-progress choices -- department, doctor, date,
 * time, and their details. Everything about *availability* stays in React Query
 * so it is refetched rather than remembered: a cached slot list is exactly the
 * thing that must not go stale mid-flow.
 */

import { create } from 'zustand';
import type { BookingResult, PublicPractitioner } from '@/types/domain';

type BookingState = {
  department: string | null;
  practitioner: PublicPractitioner | null;
  date: string | null;
  time: string | null;
  details: {
    first_name: string;
    last_name: string;
    phone: string;
    email: string;
    reason: string;
  } | null;
  result: BookingResult | null;

  setDepartment: (department: string | null) => void;
  setPractitioner: (practitioner: PublicPractitioner) => void;
  setDate: (date: string) => void;
  setTime: (time: string | null) => void;
  setDetails: (details: NonNullable<BookingState['details']>) => void;
  setResult: (result: BookingResult) => void;
  reset: () => void;
};

const EMPTY = {
  department: null,
  practitioner: null,
  date: null,
  time: null,
  details: null,
  result: null,
} as const;

export const useBookingStore = create<BookingState>((set) => ({
  ...EMPTY,

  setDepartment: (department) =>
    // Changing department invalidates every downstream choice.
    set({ department, practitioner: null, date: null, time: null }),

  setPractitioner: (practitioner) => set({ practitioner, date: null, time: null }),

  setDate: (date) => set({ date, time: null }),

  setTime: (time) => set({ time }),

  setDetails: (details) => set({ details }),

  setResult: (result) => set({ result }),

  reset: () => set({ ...EMPTY }),
}));
