import { useState } from 'react';
import { HamburgerMenu } from '../components/HamburgerMenu';
import { WeekAtAGlance } from '../components/DailyEvents';
import { CalendarView } from '../components/CalendarView';
import { EventInput } from '../components/EventInput';
import type { ParsedEvent } from '../services/openai';
import './LandingPage.css';

interface LandingPageProps {
  onNavigate: (page: string) => void;
  onDateClick: (date: Date) => void;
  onEventsExtracted: (events: ParsedEvent[]) => void;
}

export function LandingPage({ onNavigate, onDateClick, onEventsExtracted }: LandingPageProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [modalActive, setModalActive] = useState(false);

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    onDateClick?.(date);
  };

  return (
    <div className="landing-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="landing-rail" style={{ marginTop: '80px' }}>
        {!modalActive && (
          <section className="rail-card">
            <WeekAtAGlance onDateClick={handleDateSelect} />
          </section>
        )}

        <section className="rail-card">
          <CalendarView
            selectedDate={selectedDate}
            onDateSelect={setSelectedDate}
            onEventClick={() => setModalActive(true)}
            onModalClose={() => setModalActive(false)}
          />
        </section>

        {!modalActive && (
          <section className="rail-card">
            <EventInput onEventsExtracted={onEventsExtracted} />
          </section>
        )}
      </div>
    </div>
  );
}
