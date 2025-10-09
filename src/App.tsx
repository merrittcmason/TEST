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

let launchedInThisTab = false;

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [showLaunch, setShowLaunch] = useState<boolean>(() => !launchedInThisTab);
  const [showWelcome, setShowWelcome] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [extractedEvents, setExtractedEvents] = useState<ParsedEvent[]>([]);
  const [userName, setUserName] = useState('User');

  const hasShownWelcomeRef = useRef(false);
  const justFinishedLaunchRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!launchedInThisTab) {
      launchedInThisTab = true;
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      (async () => {
        try {
          const userData = await DatabaseService.getUser(user.id);
          if (userData?.name) setUserName(userData.name);
        } catch {}
      })();
    }
  }, [user, authLoading]);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (uid !== lastUserIdRef.current) {
      hasShownWelcomeRef.current = false;
      lastUserIdRef.current = uid;
    }
    if (!authLoading && uid && !showLaunch && !hasShownWelcomeRef.current && !justFinishedLaunchRef.current) {
      setShowWelcome(true);
      hasShownWelcomeRef.current = true;
    }
  }, [authLoading, user, showLaunch]);

  const handleLaunchComplete = () => {
    setShowLaunch(false);
    justFinishedLaunchRef.current = true;
    if (user && !hasShownWelcomeRef.current) {
      setShowWelcome(true);
      hasShownWelcomeRef.current = true;
    }
    setTimeout(() => {
      justFinishedLaunchRef.current = false;
    }, 500);
  };

  const handleWelcomeComplete = () => {
    setShowWelcome(false);
  };

  const handleNavigate = (page: string) => {
    setCurrentPage(page as Page);
  };

  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
  };

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

  if (window.location.pathname === '/debug-auth') {
    return <DebugAuth />;
  }

  if (showLaunch) {
    return <LaunchScreen onComplete={handleLaunchComplete} />;
  }

  if (showWelcome && user) {
    return <WelcomeScreen userName={userName} onComplete={handleWelcomeComplete} />;
  }

  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  if (currentPage === 'eventConfirmation' && extractedEvents.length > 0) {
    return (
      <EventConfirmation
        events={extractedEvents}
        onConfirm={handleEventsConfirmed}
        onCancel={handleEventsCancelled}
      />
    );
  }

  if (currentPage === 'settings') {
    return <SettingsPage onNavigate={handleNavigate} />;
  }

  if (currentPage === 'account') {
    return <AccountPage onNavigate={handleNavigate} />;
  }

  if (currentPage === 'subscription') {
    return <SubscriptionPage onNavigate={handleNavigate} />;
  }

  return (
    <LandingPage
      onNavigate={handleNavigate}
      onDateClick={handleDayClick}
      onEventsExtracted={handleEventsExtracted}
    />
  );
}

function DebugAuth() {
  const [session, setSession] = useState<any>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <pre style={{ whiteSpace: 'pre-wrap', padding: 20 }}>
      SESSION: {JSON.stringify(session, null, 2)}
      {'\n\n'}
      USER: {JSON.stringify(user, null, 2)}
    </pre>
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
