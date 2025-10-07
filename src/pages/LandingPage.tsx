import { HamburgerMenu } from '../components/HamburgerMenu';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { WeekAtAGlance } from '../components/WeekAtAGlance';
import { AssignmentsDue } from '../components/AssignmentsDue';
import { useMode } from '../contexts/ModeContext';
import { EventInput } from '../components/EventInput';
import type { ParsedEvent } from '../services/openai';
import './LandingPage.css';

interface LandingPageProps {
  onNavigate: (page: string) => void;
  onDateClick: (date: Date) => void;
  onEventsExtracted: (events: ParsedEvent[]) => void;
}

export function LandingPage({ onNavigate, onDateClick, onEventsExtracted }: LandingPageProps) {
  const { mode } = useMode();

  return (
    <div className="landing-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="landing-container">
        <div className="landing-input-wrapper">
          <EventInput onEventsExtracted={onEventsExtracted} mode={mode} />
        </div>

        <main className="landing-content">
          <SubscriptionCard />
          {mode === 'education' && <AssignmentsDue onDateClick={onDateClick} />}
          <WeekAtAGlance onDateClick={onDateClick} />
        </main>
      </div>
    </div>
  );
}
