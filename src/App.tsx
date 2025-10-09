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
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

type Page = 'landing' | 'settings' | 'account' | 'subscription' | 'eventConfirmation';
type Event = Database['public']['Tables']['events']['Row'];

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [stage, setStage] = useState<'launch' | 'auth' | 'welcome' | 'landing'>('launch');
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [extractedEvents, setExtractedEvents] = useState<ParsedEvent[]>([]);
  const [userName, setUserName] = useState('User');

  const bootstrappingRef = useRef(true);
  const hasShownWelcomeRef = useRef(false);
  const welcomeDelayMs = 2800;

  useEffect(() => {
    const startup = async () => {
      setStage('launch');
      await new Promise(r => setTimeout(r, 1200));
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (session) {
        if (!hasShownWelcomeRef.current) {
          setStage('welcome');
          hasShownWelcomeRef.current = true;
          await new Promise(r => setTimeout(r, welcomeDelayMs));
        }
        setStage('landing');
      } else {
        setStage('auth');
      }
      bootstrappingRef.current = false;
    };
    startup();
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      (async () => {
        const u = await DatabaseService.getUser(user.id);
        if (u?.name) setUserName(u.name);
      })();
    }
  }, [user, authLoading]);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (bootstrappingRef.current) return;
      if (event === 'SIGNED_IN') {
        if (!hasShownWelcomeRef.current) {
          setStage('welcome');
          hasShownWelcomeRef.current = true;
          await new Promise(r => setTimeout(r, welcomeDelayMs));
        }
        setStage('landing');
      } else if (event === 'SIGNED_OUT') {
        hasShownWelcomeRef.current = false;
        setStage('launch');
        await new Promise(r => setTimeout(r, 800));
        setStage('auth');
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

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
  if (stage === 'welcome' && user) return <WelcomeScreen userName={userName} />;

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
