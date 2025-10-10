// src/contexts/AuthContext.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { AuthService } from '../services/auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithOAuth: (provider: 'google' | 'github' | 'apple') => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AuthService.getCurrentUser().then((u) => {
      setUser(u);
      setLoading(false);
    });

    const { data: { subscription } } = AuthService.onAuthStateChange((_event, u) => {
      setUser(u);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, name?: string) => {
    sessionStorage.setItem('skipLaunchOnce', '1');
    await AuthService.signUp(email, password, name);
  };

  const signIn = async (email: string, password: string) => {
    sessionStorage.setItem('skipLaunchOnce', '1');
    await AuthService.signIn(email, password);
  };

  const signInWithOAuth = async (provider: 'google' | 'github' | 'apple') => {
    sessionStorage.setItem('skipLaunchOnce', '1');
    await AuthService.signInWithOAuth(provider);
  };

  const signOut = async () => {
    await AuthService.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signInWithOAuth, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
