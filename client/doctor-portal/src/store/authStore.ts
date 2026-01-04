import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * User roles matching the blockchain pallet
 */
export type Role = 'Admin' | 'Doctor' | 'Nurse' | 'LabTechnician' | 'Pharmacist' | 'Patient';

/**
 * User information
 */
export interface User {
  userId: string;
  username: string;
  role: Role;
  createdAt: string;
}

/**
 * Auth store state
 */
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  login: (userId: string) => Promise<void>;
  logout: () => void;
  setUser: (user: User) => void;
  clearError: () => void;
}

/**
 * Demo users for hackathon presentation
 */
const DEMO_USERS: Record<string, User> = {
  'ADMIN-001': {
    userId: 'ADMIN-001',
    username: 'admin',
    role: 'Admin',
    createdAt: new Date().toISOString(),
  },
  'DOC-001': {
    userId: 'DOC-001',
    username: 'dr.smith',
    role: 'Doctor',
    createdAt: new Date().toISOString(),
  },
  'NURSE-001': {
    userId: 'NURSE-001',
    username: 'nurse.johnson',
    role: 'Nurse',
    createdAt: new Date().toISOString(),
  },
  'LAB-001': {
    userId: 'LAB-001',
    username: 'lab.tech',
    role: 'LabTechnician',
    createdAt: new Date().toISOString(),
  },
};

/**
 * Auth store with persistence
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (userId: string) => {
        set({ isLoading: true, error: null });

        try {
          // In production, this would call the API
          // For demo, use hardcoded users
          const user = DEMO_USERS[userId];

          if (!user) {
            throw new Error('Invalid user ID. Try: DOC-001, NURSE-001, or ADMIN-001');
          }

          // Simulate network delay
          await new Promise((resolve) => setTimeout(resolve, 500));

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (error) {
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Login failed',
          });
        }
      },

      logout: () => {
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
      },

      setUser: (user: User) => {
        set({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      },

      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: 'medichain-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

/**
 * Helper to check if user has healthcare provider role
 */
export function isHealthcareProvider(role: Role): boolean {
  return ['Admin', 'Doctor', 'Nurse', 'LabTechnician', 'Pharmacist'].includes(role);
}

/**
 * Helper to check if user can edit medical records
 */
export function canEditMedicalRecords(role: Role): boolean {
  return ['Admin', 'Doctor', 'Nurse'].includes(role);
}

/**
 * Helper to check if user is admin
 */
export function isAdmin(role: Role): boolean {
  return role === 'Admin';
}
