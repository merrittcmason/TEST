import { useState } from 'react';
import { CalendarView } from '../components/CalendarView';
import { EventInput } from '../components/EventInput';
import { HamburgerMenu } from '../components/HamburgerMenu';
import type { ParsedEvent } from '../services/openai';
import type { Database } from '../lib/supabase';
import './CalendarPage.css';

type Event = Database['public']['Tables']['events']['Row'];

interface CalendarPageProps {
  initialDate?: Date;
  onNavigate: (page: string) => void;
  onEventsExtracted: (events: ParsedEvent[]) => void;
}

export function CalendarPage({ initialDate, onNavigate, onEventsExtracted }: CalendarPageProps) {
  const [selectedDate, setSelectedDate] = useState(initialDate || new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  const handleEventClick = (event: Event) => {
    setSelectedEvent(event);
  };

  return (
    <div className="calendar-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="calendar-container">
        <header className="calendar-page-header">
          <h1 className="calendar-page-title">Calendar Pilot</h1>
        </header>

        <main className="calendar-content">
          <CalendarView
            selectedDate={selectedDate}
            onDateSelect={setSelectedDate}
            onEventClick={handleEventClick}
          />

          <EventInput onEventsExtracted={onEventsExtracted} />
        </main>
      </div>

      {selectedEvent && (
        <div className="event-modal-overlay" onClick={() => setSelectedEvent(null)}>
          <div className="event-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{selectedEvent.name}</h3>
            <div className="event-details">
              <p>
                <strong>Date:</strong> {selectedEvent.date}
              </p>
              {selectedEvent.time && (
                <p>
                  <strong>Time:</strong> {selectedEvent.time}
                </p>
              )}
              {selectedEvent.tag && (
                <p>
                  <strong>Tag:</strong> {selectedEvent.tag}
                </p>
              )}
            </div>
            <button
              onClick={() => setSelectedEvent(null)}
              className="btn btn-primary"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
