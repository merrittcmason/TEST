import { useEffect, useState } from 'react';
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
import { CompleteProfilePage } from './pages/CompleteProfilePage';
import type { ParsedEvent } from './services/openai';
import { DatabaseService } from './services/database';
import { supabase } from './lib/supabase';
import './styles/theme.css';

type Page = 'landing' | 'settings' | 'account' | 'subscription' | 'eventConfirmation';

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [showLaunch, setShowLaunch] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);
  const [firstTime, setFirstTime] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [firstName, setFirstName] = useState('User');
  const [extractedEvents, setExtractedEvents] = useState<ParsedEvent[]>([]);
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [ready, setReady] = useState(false);
  const [dbUser, setDbUser] = useState<any>(null);

  useEffect(() => {
    const timer = setTimeout(() => setShowLaunch(false), 900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const initialize = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await new Promise(r => setTimeout(r, 200));
      }
      setReady(true);
    };
    initialize();
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!user) {
        setNeedsProfile(false);
        setShowWelcome(false);
        setDbUser(null);
        return;
      }
      const u = await DatabaseService.getUser(user.id);
      if (!active) return;
      setDbUser(u);
      if (u) {
        setFirstName(u.first_name);
        setNeedsProfile(!u.profile_completed);
        if (u.profile_completed && u.first_name) {
          setFirstTime(!u.last_login_at);
          setShowWelcome(true);
          setTimeout(() => active && setShowWelcome(false), 1600);
        }
      }
    };
    if (ready && !authLoading) load();
    return () => {
      active = false;
    };
  }, [user, ready, authLoading]);

  const handleProfileDone = () => {
    setNeedsProfile(false);
    setShowWelcome(true);
    setTimeout(() => setShowWelcome(false), 1600);
  };

  const handleNavigate = (page: string) => setCurrentPage(page as Page);

  const handleEventsExtracted = (events: ParsedEvent[]) => {
    setExtractedEvents(events);
    setCurrentPage('eventConfirmation');
  };

  if (showLaunch) return <LaunchScreen onComplete={() => {}} />;

  if (!ready || authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!user) return <AuthPage />;

  if (!dbUser) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (needsProfile) return <CompleteProfilePage onDone={handleProfileDone} />;

  if (showWelcome)
    return <WelcomeScreen userName={firstName} onComplete={() => setShowWelcome(false)} firstTime={firstTime} />;

  if (currentPage === 'eventConfirmation' && extractedEvents.length > 0)
    return (
      <EventConfirmation
        events={extractedEvents}
        onConfirm={() => {
          setExtractedEvents([]);
          setCurrentPage('landing');
        }}
        onCancel={() => {
          setExtractedEvents([]);
          setCurrentPage('landing');
        }}
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

export default function App() {
  return (
    <AuthProvider>
      <ModeProvider>
        <AppContent />
      </ModeProvider>
    </AuthProvider>
  );
}
