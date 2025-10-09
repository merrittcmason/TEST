import { useEffect, useRef, useState } from 'react';
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

type Page = 'landing' | 'settings' | 'account' | 'subscription' | 'eventConfirmation';
type Event = Database['public']['Tables']['events']['Row'];

const LAUNCH_DURATION = 2500;
const WELCOME_DURATION = 3200;

function AppContent() {
  const { user, loading: authLoading } = useAuth();

  const [stage, setStage] = useState<'launch' | 'auth' | 'welcome' | 'landing'>('launch');
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [extractedEvents, setExtractedEvents] = useState<ParsedEvent[]>([]);
  const [userName, setUserName] = useState('User');

  const launchTimerRef = useRef<number | null>(null);
  const welcomeTimerRef = useRef<number | null>(null);
  const launchTimerFiredRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);
  const hasShownWelcomeForThisUserRef = useRef(false);

  useEffect(() => {
    setStage('launch');
    launchTimerRef.current = window.setTimeout(() => {
      launchTimerFiredRef.current = true;
      if (user) {
        hasShownWelcomeForThisUserRef.current = false;
        setStage('welcome');
        welcomeTimerRef.current = window.setTimeout(() => setStage('landing'), WELCOME_DURATION);
      } else {
        setStage('auth');
      }
    }, LAUNCH_DURATION);

    return () => {
      if (launchTimerRef.current) {
        clearTimeout(launchTimerRef.current);
        launchTimerRef.current = null;
      }
      if (welcomeTimerRef.current) {
        clearTimeout(welcomeTimerRef.current);
        welcomeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!user || authLoading) return;
    (async () => {
      try {
        const profile = await DatabaseService.getUser(user.id);
        if ((profile as any)?.name) setUserName((profile as any).name as string);
        else if ((user as any)?.user_metadata?.name) setUserName((user as any).user_metadata.name as string);
        else if (user.email) setUserName(user.email.split('@')[0]);
        else setUserName('User');
      } catch {
        if (user.email) setUserName(user.email.split('@')[0]);
      }
    })();
  }, [user, authLoading]);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      lastUserIdRef.current = null;
      hasShownWelcomeForThisUserRef.current = false;
      if (stage !== 'launch') {
        setStage('auth');
      }
      return;
    }

    if (lastUserIdRef.current !== user.id) {
      lastUserIdRef.current = user.id;
      hasShownWelcomeForThisUserRef.current = false;
    }

    if (stage === 'auth' && user) {
      if (!hasShownWelcomeForThisUserRef.current) {
        setStage('welcome');
        hasShownWelcomeForThisUserRef.current = true;
        if (welcomeTimerRef.current) clearTimeout(welcomeTimerRef.current);
        welcomeTimerRef.current = window.setTimeout(() => setStage('landing'), WELCOME_DURATION);
      } else {
        setStage('landing');
      }
    }

    if (stage === 'launch' && launchTimerFiredRef.current && user) {
      if (!hasShownWelcomeForThisUserRef.current) {
        setStage('welcome');
        hasShownWelcomeForThisUserRef.current = true;
        if (welcomeTimerRef.current) clearTimeout(welcomeTimerRef.current);
        welcomeTimerRef.current = window.setTimeout(() => setStage('landing'), WELCOME_DURATION);
      } else {
        setStage('landing');
      }
    }
  }, [user, authLoading, stage]);

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
  if (stage === 'welcome' && user) return <WelcomeScreen userName={userName} onComplete={() => setStage('landing')} />;

  if (stage === 'landing' && user) {
    if (currentPage === 'eventConfirmation' && extractedEvents.length > 0) {
      return (
        <EventConfirmation
          events={extractedEvents}
          onConfirm={handleEventsConfirmed}
          onCancel={handleEventsCancelled}
        />
      );
    }
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

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div className="loading-spinner" />
    </div>
  );
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
