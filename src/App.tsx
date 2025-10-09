import { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ModeProvider } from './contexts/ModeContext';
import { LaunchScreen } from './components/LaunchScreen';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AuthPage } from './pages/AuthPage';
import { LandingPage } from './pages/LandingPage';
import { EventConfirmation } from './pages/EventConfirmation';
import { SettingsPage } from './pages/SettingsPage';
import { AccountPage } from './pages/AccountPage';
import { SubscriptionPage } from './pages/SubscriptionPage';
import type { ParsedEvent } from './services/openai';
import type { Database } from './lib/supabase';
import { DatabaseService } from './services/database';
import './styles/theme.css';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

type Page = 'landing' | 'settings' | 'account' | 'subscription' | 'eventConfirmation';
type Event = Database['public']['Tables']['events']['Row'];

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [stage, setStage] = useState<'launch' | 'auth' | 'welcome' | 'landing'>('launch');
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [extractedEvents, setExtractedEvents] = useState<ParsedEvent[]>([]);
  const [userName, setUserName] = useState('User');
  const [launchComplete, setLaunchComplete] = useState(false);

  const hasShownWelcomeRef = useRef(false);
  const lastUserRef = useRef<string | null>(null);

  const LAUNCH_DURATION = 2500;
  const WELCOME_DURATION = 3000;

  useEffect(() => {
    const started = sessionStorage.getItem('launchedOnce');
    if (!started) {
      setStage('launch');
      sessionStorage.setItem('launchedOnce', 'true');
      setTimeout(() => {
        setLaunchComplete(true);
      }, LAUNCH_DURATION);
    } else {
      setLaunchComplete(true);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user && launchComplete) {
      if (lastUserRef.current !== user.id) {
        lastUserRef.current = user.id;
        hasShownWelcomeRef.current = false;
      }

      if (!hasShownWelcomeRef.current) {
        setStage('welcome');
        hasShownWelcomeRef.current = true;
        setTimeout(() => setStage('landing'), WELCOME_DURATION);
      } else {
        setStage('landing');
      }

      (async () => {
        try {
          const data = await DatabaseService.getUser(user.id);
          if (data?.name) setUserName(data.name);
        } catch {}
      })();
    } else if (!authLoading && !user && launchComplete) {
      setStage('auth');
    }
  }, [user, authLoading, launchComplete]);

  const handleNavigate = (page: string) => setCurrentPage(page as Page);
  const handleEventsExtracted = (events: ParsedEvent[]) => {
    setExtractedEvents(events);
    setCurrentPage('eventConfirmation');
  };
  const handleEventsConfirmed = () => {
    setExtractedEvents([]);
    setCurrentPage('landing');
  };
  const handleEventsCancelled = () => {
    setExtractedEvents([]);
    setCurrentPage('landing');
  };

  if (stage === 'launch') return <LaunchScreen />;
  if (stage === 'auth') return <AuthPage />;
  if (stage === 'welcome' && user)
    return <WelcomeScreen userName={userName} onComplete={() => setStage('landing')} />;

  if (stage === 'landing' && user) {
    if (currentPage === 'eventConfirmation' && extractedEvents.length > 0)
      return (
        <EventConfirmation
          events={extractedEvents}
          onConfirm={handleEventsConfirmed}
          onCancel={handleEventsCancelled}
        />
      );
    if (currentPage === 'settings') return <SettingsPage onNavigate={handleNavigate} />;
    if (currentPage === 'account') return <AccountPage onNavigate={handleNavigate} />;
    if (currentPage === 'subscription') return <SubscriptionPage onNavigate={handleNavigate} />;
    return (
      <LandingPage
        onNavigate={handleNavigate}
        onDateClick={() => {}}
        onEventsExtracted={handleEventsExtracted}
      />
    );
  }

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <ModeProvider>
        <AppContent />
      </ModeProvider>
    </AuthProvider>
  );
}
