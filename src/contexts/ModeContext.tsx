import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { DatabaseService } from '../services/database';

export type AppMode = 'standard' | 'education' | 'work' | 'enterprise';

interface ModeContextType {
  mode: AppMode;
  setMode: (mode: AppMode) => Promise<void>;
  loading: boolean;
}

const ModeContext = createContext<ModeContextType | undefined>(undefined);

export function ModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [mode, setModeState] = useState<AppMode>('standard');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const loadMode = async () => {
      try {
        const userData = await DatabaseService.getUser(user.id);
        if (userData && (userData as any).mode) {
          setModeState((userData as any).mode as AppMode);
        }
      } catch (error) {
        console.error('Failed to load user mode:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMode();
  }, [user]);

  const setMode = async (newMode: AppMode) => {
    if (newMode === 'enterprise') {
      return;
    }

    if (!user) {
      setModeState(newMode);
      return;
    }

    try {
      await DatabaseService.updateUserMode(user.id, newMode);
      setModeState(newMode);
    } catch (error) {
      console.error('Failed to update mode:', error);
      throw error;
    }
  };

  return (
    <ModeContext.Provider value={{ mode, setMode, loading }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const context = useContext(ModeContext);
  if (context === undefined) {
    throw new Error('useMode must be used within a ModeProvider');
  }
  return context;
}

export const MODE_CONFIG = {
  standard: {
    name: 'Standard',
    icon: '👤',
    defaultTime: null,
    tags: ['Personal', 'Work', 'Family', 'Health', 'Other'],
  },
  education: {
    name: 'Education',
    icon: '🎓',
    defaultTime: '23:59',
    tags: ['Homework', 'Quiz', 'Test', 'Project', 'Lab', 'Exam', 'Class', 'Study'],
    assignmentTags: ['Homework', 'Quiz', 'Test', 'Project', 'Lab', 'Exam'],
  },
  work: {
    name: 'Work',
    icon: '💼',
    defaultTime: null,
    tags: ['Meeting', 'Interview', 'Conference', 'Deadline', 'Review', 'Training'],
  },
  enterprise: {
    name: 'Enterprise',
    icon: '🏢',
    defaultTime: null,
    tags: [],
    comingSoon: true,
  },
} as const;
