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
          if (a.all_day && !b.all_day) return 1;
          if (!a.all_day && b.all_day) return -1;
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

  return (
    <div className="calendar-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="calendar-container">
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

            <div className="day-detail-events-list">
              {dayEvents.length === 0 ? (
                <div className="no-events-message">No events scheduled for this day</div>
              ) : (
                dayEvents.map(event => (
                  <div key={event.id} className="day-event-card">
                    <div className="event-card-info">
                      <div className="event-card-time">
                        {event.time ? format(new Date(`2000-01-01T${event.time}`), 'h:mm a') : 'All day'}
                      </div>
                      <div className="event-card-details">
                        <div className="event-card-name">{event.name}</div>
                        {event.tag && <div className="event-card-tag">{event.tag}</div>}
                      </div>
                    </div>
                    <div className="event-card-actions">
                      <button
                        className="btn-icon"
                        onClick={() => setSelectedEvent(event)}
                        title="View details"
                      >
                        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                      <button
                        className="btn-icon"
                        onClick={() => {}}
                        title="Edit event"
                      >
                        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))
              )}
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
