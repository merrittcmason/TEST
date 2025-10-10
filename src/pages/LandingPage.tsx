// src/pages/LandingPage.tsx
import { useState } from 'react';
import { HamburgerMenu } from '../components/HamburgerMenu';
import { WeekAtAGlance } from '../components/WeekAtAGlance';
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

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    onDateClick?.(date);
  };

  return (
    <div className="landing-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="landing-container">
        <main className="landing-content">
          {/* 1) Week at a Glance */}
          <WeekAtAGlance onDateClick={handleDateSelect} />

          {/* 2) Calendar */}
const [modalActive, setModalActive] = useState(false);

<CalendarView
  selectedDate={selectedDate}
  onDateSelect={setSelectedDate}
  onEventClick={(event) => { setModalActive(true); }}
  onModalClose={() => { setModalActive(false); }}
/>

{!modalActive && <HamburgerMenu />}
{!modalActive && <EventInput />}

          {/* 3) Input method (fixed-bottom pill via CSS) */}
          <EventInput onEventsExtracted={onEventsExtracted} />
        </main>
      </div>
    </div>
  );
}
