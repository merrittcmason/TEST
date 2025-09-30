import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LaunchScreen } from './components/LaunchScreen';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AuthPage } from './pages/AuthPage';
import { LandingPage } from './pages/LandingPage';
import { CalendarPage } from './pages/CalendarPage';
import { EventConfirmation } from './pages/EventConfirmation';
import type { ParsedEvent } from './services/openai';
import { DatabaseService } from './services/database';
import './styles/theme.css';

type Page = 'landing' | 'calendar' | 'settings' | 'account' | 'subscription' | 'export' | 'eventConfirmation';

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const [showLaunch, setShowLaunch] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
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

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
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
        onNavigate={handleNavigate}
        onEventsExtracted={handleEventsExtracted}
      />
    );
  }

  if (currentPage === 'settings' || currentPage === 'account' || currentPage === 'subscription' || currentPage === 'export') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '24px' }}>
        <h1>{currentPage.charAt(0).toUpperCase() + currentPage.slice(1)} Page</h1>
        <p style={{ color: 'var(--text-secondary)' }}>This page is coming soon!</p>
        <button className="btn btn-primary" onClick={() => setCurrentPage('landing')}>
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <LandingPage
      onNavigate={handleNavigate}
      onDateClick={handleDateClick}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
