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
import './styles/theme.css';

type Page = 'landing' | 'settings' | 'account' | 'subscription' | 'eventConfirmation';
type Event = Database['public']['Tables']['events']['Row'];

const LAUNCH_MS = 2200;
const WELCOME_MS = 2600;

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const firstMount = useRef(true);
  const prevUser = useRef<typeof user>(null);

  const [ui, setUi] = useState<'launch' | 'welcome' | 'auth' | 'app'>('launch');
  const [page, setPage] = useState<Page>('landing');

  const [extractedEvents, setExtractedEvents] = useState<ParsedEvent[]>([]);
  const [userName, setUserName] = useState('User');

  useEffect(() => {
    if (authLoading) return;
    if (firstMount.current) {
      firstMount.current = false;
      setUi('launch');
      const t = setTimeout(() => {
        if (user) {
          setUserName(user.user_metadata?.name || user.email || 'User');
          setUi('welcome');
          const w = setTimeout(() => setUi('app'), WELCOME_MS);
          return () => clearTimeout(w);
        } else {
          setUi('auth');
        }
      }, LAUNCH_MS);
      return () => clearTimeout(t);
    } else {
      const was = prevUser.current;
      const now = user;
      if (!was && now) {
        setUserName(now.user_metadata?.name || now.email || 'User');
        setUi('welcome');
        const w = setTimeout(() => setUi('app'), WELCOME_MS);
        prevUser.current = now;
        return () => clearTimeout(w);
      }
      if (was && !now) {
        setUi('auth');
      }
    }
    prevUser.current = user;
  }, [authLoading, user]);

  const handleNavigate = (p: string) => setPage(p as Page);
  const handleEventsExtracted = (events: ParsedEvent[]) => {
    setExtractedEvents(events);
    setPage('eventConfirmation');
    setUi('app');
  };
  const handleEventsConfirmed = () => {
    setExtractedEvents([]);
    setPage('landing');
  };
  const handleEventsCancelled = () => {
    setExtractedEvents([]);
    setPage('landing');
  };

  if (ui === 'launch') {
    return <LaunchScreen onComplete={() => {}} />;
  }

  if (ui === 'welcome') {
    return <WelcomeScreen userName={userName} onComplete={() => setUi('app')} />;
  }

  if (ui === 'auth') {
    return <AuthPage />;
  }

  if (ui === 'app') {
    if (page === 'eventConfirmation' && extractedEvents.length > 0) {
      return (
        <EventConfirmation
          events={extractedEvents}
          onConfirm={handleEventsConfirmed}
          onCancel={handleEventsCancelled}
        />
      );
    }
    if (page === 'settings') return <SettingsPage onNavigate={handleNavigate} />;
    if (page === 'account') return <AccountPage onNavigate={handleNavigate} />;
    if (page === 'subscription') return <SubscriptionPage onNavigate={handleNavigate} />;
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
