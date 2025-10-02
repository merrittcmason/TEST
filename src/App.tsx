import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LaunchScreen } from './components/LaunchScreen';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AuthPage } from './pages/AuthPage';
import { LandingPage } from './pages/LandingPage';
import { CalendarPage } from './pages/CalendarPage';
import { EventConfirmation } from './pages/EventConfirmation';
import { SettingsPage } from './pages/SettingsPage';
import { AccountPage } from './pages/AccountPage';
import { SubscriptionPage } from './pages/SubscriptionPage';
import { ExportPage } from './pages/ExportPage';
import type { ParsedEvent } from './services/openai';
import type { Database } from './lib/supabase';
import { DatabaseService } from './services/database';
import './styles/theme.css';

// 👇 add supabase client for debug
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

type Page = 'landing' | 'calendar' | 'settings' | 'account' | 'subscription' | 'export' | 'eventConfirmation';
type Event = Database['public']['Tables']['events']['Row'];

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [showLaunch, setShowLaunch] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [extractedEvents, setExtractedEvents] = useState<ParsedEvent[]>([]);
  const [userName, setUserName] = useState('User');

  useEffect(() => {
    const hasVisited = sessionStorage.getItem('hasVisited');
    if (hasVisited) {
      setShowLaunch(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      const loadUserData = async () => {
        try {
          const userData = await DatabaseService.getUser(user.id);
          if (userData?.name) {
            setUserName(userData.name);
          }
        } catch (error) {
          console.error('Failed to load user data:', error);
        }
      };
      loadUserData();
    }
  }, [user, authLoading]);

  const handleLaunchComplete = () => {
    sessionStorage.setItem('hasVisited', 'true');
    setShowLaunch(false);

    if (user) {
      const hasSeenWelcome = sessionStorage.getItem('hasSeenWelcome');
      if (!hasSeenWelcome) {
        setShowWelcome(true);
      }
    }
  };

  const handleWelcomeComplete = () => {
    sessionStorage.setItem('hasSeenWelcome', 'true');
    setShowWelcome(false);
  };

  const handleNavigate = (page: string) => {
    setCurrentPage(page as Page);
  };

  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
    setSelectedEvent(null);
    setCurrentPage('calendar');
  };

  const handleEventsExtracted = (events: ParsedEvent[]) => {
    setExtractedEvents(events);
    setCurrentPage('eventConfirmation');
  };

  const handleEventsConfirmed = () => {
    setExtractedEvents([]);
    setCurrentPage('calendar');
  };

  const handleEventsCancelled = () => {
    setExtractedEvents([]);
    setCurrentPage('calendar');
  };

  // 👇 special case: check if URL contains /debug-auth
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

  if (currentPage === 'calendar') {
    return (
      <CalendarPage
        initialDate={selectedDate || undefined}
        selectedEvent={selectedEvent}
        onNavigate={handleNavigate}
        onEventsExtracted={handleEventsExtracted}
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

  if (currentPage === 'export') {
    return <ExportPage onNavigate={handleNavigate} />;
  }

  return (
    <LandingPage
      onNavigate={handleNavigate}
      onDateClick={handleDayClick}
    />
  );
}

// 👇 DebugAuth component definition
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
      {"\n\n"}
      USER: {JSON.stringify(user, null, 2)}
    </pre>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
