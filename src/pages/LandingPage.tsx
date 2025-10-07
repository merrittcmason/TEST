import { HamburgerMenu } from '../components/HamburgerMenu';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { WeekAtAGlance } from '../components/WeekAtAGlance';
import { AssignmentsDue } from '../components/AssignmentsDue';
import { useMode } from '../contexts/ModeContext';
import './LandingPage.css';

interface LandingPageProps {
  onNavigate: (page: string) => void;
  onDateClick: (date: Date) => void;
}

export function LandingPage({ onNavigate, onDateClick }: LandingPageProps) {
  const { mode } = useMode();

  return (
    <div className="landing-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="landing-container">
        <main className="landing-content">
          <SubscriptionCard />
          {mode === 'education' && <AssignmentsDue onDateClick={onDateClick} />}
          <WeekAtAGlance onDateClick={onDateClick} />
        </main>
      </div>
    </div>
  );
}
