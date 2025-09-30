import { HamburgerMenu } from '../components/HamburgerMenu';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { WeekAtAGlance } from '../components/WeekAtAGlance';
import { Notifications } from '../components/Notifications';
import './LandingPage.css';

interface LandingPageProps {
  onNavigate: (page: string) => void;
  onDateClick: (date: Date) => void;
}

export function LandingPage({ onNavigate, onDateClick }: LandingPageProps) {
  return (
    <div className="landing-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="landing-container">
        <header className="landing-header">
          <h1 className="landing-title">Calendar Pilot</h1>
        </header>

        <main className="landing-content">
          <SubscriptionCard />
          <WeekAtAGlance onDateClick={onDateClick} />
          <Notifications />
        </main>
      </div>
    </div>
  );
}
