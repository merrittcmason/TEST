import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { CalendarView } from '../components/CalendarView';
import { EventInput } from '../components/EventInput';
import { HamburgerMenu } from '../components/HamburgerMenu';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import type { ParsedEvent } from '../services/openai';
import type { Database } from '../lib/supabase';
import './CalendarPage.css';

type Event = Database['public']['Tables']['events']['Row'];

interface CalendarPageProps {
  initialDate?: Date;
  selectedEvent?: Event | null;
  onNavigate: (page: string) => void;
  onEventsExtracted: (events: ParsedEvent[]) => void;
}

export function CalendarPage({ initialDate, selectedEvent: initialEvent, onNavigate, onEventsExtracted }: CalendarPageProps) {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(initialDate || new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(initialEvent || null);
  const [showDayDetail, setShowDayDetail] = useState(!!initialEvent);
  const [dayEvents, setDayEvents] = useState<Event[]>([]);

  const handleEventClick = (event: Event) => {
    setSelectedEvent(event);
    setShowDayDetail(false);
  };

  useEffect(() => {
    if (!user || !showDayDetail) return;

    const loadDayEvents = async () => {
      try {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const events = await DatabaseService.getEvents(user.id, dateStr, dateStr);
        const sortedEvents = events.sort((a, b) => {
          if (a.all_day && !b.all_day) return -1;
          if (!a.all_day && b.all_day) return 1;
          if (!a.time || !b.time) return 0;
          return a.time.localeCompare(b.time);
        });
        setDayEvents(sortedEvents);
      } catch (error) {
        console.error('Failed to load day events:', error);
      }
    };

    loadDayEvents();
  }, [user, selectedDate, showDayDetail]);

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    setShowDayDetail(true);
    setSelectedEvent(null);
  };

  const handleCloseDayDetail = () => {
    setShowDayDetail(false);
  };

  const getEventPosition = (time: string | null) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    return (totalMinutes / (24 * 60)) * 100;
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
            onDateSelect={handleDateSelect}
            onEventClick={handleEventClick}
          />

          <EventInput onEventsExtracted={onEventsExtracted} />
        </main>
      </div>

      {showDayDetail && (
        <div className="day-detail-overlay" onClick={handleCloseDayDetail}>
          <div className="day-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="day-detail-header">
              <div>
                <h2 className="day-detail-title">{format(selectedDate, 'EEEE')}</h2>
                <p className="day-detail-date">{format(selectedDate, 'MMMM d, yyyy')}</p>
              </div>
              <button className="day-detail-close" onClick={handleCloseDayDetail}>
                ✕
              </button>
            </div>

            <div className="day-detail-timeline">
              <div className="timeline-hours">
                {Array.from({ length: 24 }, (_, i) => (
                  <div key={i} className="hour-marker">
                    <span className="hour-label">
                      {i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}
                    </span>
                    <div className="hour-line" />
                  </div>
                ))}
              </div>

              <div className="timeline-events">
                {dayEvents.length === 0 ? (
                  <div className="no-events-message">No events scheduled for this day</div>
                ) : (
                  dayEvents.map(event => {
                    const position = getEventPosition(event.time);
                    return (
                      <button
                        key={event.id}
                        className="timeline-event"
                        style={position !== null ? { top: `${position}%` } : undefined}
                        onClick={() => setSelectedEvent(event)}
                      >
                        <div className="event-time-badge">
                          {event.time ? format(new Date(`2000-01-01T${event.time}`), 'h:mm a') : 'All day'}
                        </div>
                        <div className="event-name-display">{event.name}</div>
                        {event.tag && <div className="event-tag-badge">{event.tag}</div>}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
