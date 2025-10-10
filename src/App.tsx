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

  useEffect(() => {
    const timer = setTimeout(() => setShowLaunch(false), 900);
    return () => clearTimeout(timer);
  }, []);

useEffect(() => {
  if (authLoading) return;
  let mounted = true;

  const run = async () => {
    if (!user) {
      setNeedsProfile(false);
      setShowWelcome(false);
      return;
    }

    await new Promise(r => setTimeout(r, 400));

    const u = await DatabaseService.getUser(user.id);
    if (!mounted) return;

    if (!u) {
      setNeedsProfile(true);
      return;
    }

    setFirstName(u.first_name || 'User');
    const completed = !!u.profile_completed;

    setNeedsProfile(!completed);

    if (completed) {
      setFirstTime(!u.last_login_at);
      setShowWelcome(true);
      setTimeout(() => mounted && setShowWelcome(false), 1600);
    }
  };

  run();
  return () => {
    mounted = false;
  };
}, [user, authLoading]);


  const handleProfileDone = () => {
    setNeedsProfile(false);
    setFirstTime(true);
    setShowWelcome(true);
    setTimeout(() => setShowWelcome(false), 1600);
  };

  const handleNavigate = (page: string) => setCurrentPage(page as Page);

  const handleEventsExtracted = (events: ParsedEvent[]) => {
    setExtractedEvents(events);
    setCurrentPage('eventConfirmation');
  };

  if (showLaunch)
    return <LaunchScreen onComplete={() => {}} />;

  if (authLoading)
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="loading-spinner" />
      </div>
    );

  if (!user)
    return <AuthPage />;

  if (needsProfile)
    return <CompleteProfilePage onDone={handleProfileDone} />;

  if (showWelcome)
    return <WelcomeScreen firstName={firstName} onComplete={() => setShowWelcome(false)} firstTime={firstTime} />;

  if (currentPage === 'eventConfirmation' && extractedEvents.length > 0)
    return (
      <EventConfirmation
        events={extractedEvents}
        onConfirm={() => { setExtractedEvents([]); setCurrentPage('landing'); }}
        onCancel={() => { setExtractedEvents([]); setCurrentPage('landing'); }}
      />
    );

  if (currentPage === 'settings') return <SettingsPage onNavigate={handleNavigate} />;
  if (currentPage === 'account') return <AccountPage onNavigate={handleNavigate} />;
  if (currentPage === 'subscription') return <SubscriptionPage onNavigate={handleNavigate} />;

  return <LandingPage onNavigate={handleNavigate} onDateClick={() => {}} onEventsExtracted={handleEventsExtracted} />;
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
