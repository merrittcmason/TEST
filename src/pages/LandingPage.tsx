import { HamburgerMenu } from '../components/HamburgerMenu';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { WeekAtAGlance } from '../components/WeekAtAGlance';
import { Notifications } from '../components/Notifications';
import type { Database } from '../lib/supabase';
import './LandingPage.css';

type Event = Database['public']['Tables']['events']['Row'];

interface LandingPageProps {
  onNavigate: (page: string) => void;
  onDateClick: (date: Date) => void;
  onEventClick: (date: Date, event: Event) => void;
}

export function LandingPage({ onNavigate, onEventClick }: LandingPageProps) {
  return (
    <div className="landing-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="landing-container">
        <header className="landing-header">
          <h1 className="landing-title">Calendar Pilot</h1>
        </header>

        <main className="landing-content">
          <SubscriptionCard />
          <WeekAtAGlance onEventClick={onEventClick} />
          <Notifications />
        </main>
      </div>
    </div>
  );
}
