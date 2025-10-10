// src/components/LaunchGate.tsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { DatabaseService } from '../services/database';
import { AuthPage } from './AuthPage';
import { CompleteProfilePage } from './CompleteProfilePage';

type Route = 'loading' | 'auth' | 'complete' | 'app';

export function LaunchGate({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<Route>('loading');

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (!user) {
        setRoute('auth');
        return;
      }
      const dbUser = await DatabaseService.getUser(user.id);
      if (!active) return;
      if (!dbUser) {
        await supabase.auth.signOut();
        setRoute('auth');
        return;
      }
      if (!dbUser.profile_completed) {
        setRoute('complete');
        return;
      }
      setRoute('app');
    })();
    return () => {
      active = false;
    };
  }, []);

  if (route === 'loading') return <div className="launch-loading">Loading…</div>;
  if (route === 'auth') return <AuthPage />;
  if (route === 'complete') return <CompleteProfilePage onDone={() => setRoute('app')} />;
  return <>{children}</>;
}
