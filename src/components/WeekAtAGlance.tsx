import { format, startOfDay } from 'date-fns';
import { useEffect, useState } from 'react';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../lib/supabase';
import './WeekAtAGlance.css';

type Event = Database['public']['Tables']['events']['Row'];

interface WeekAtAGlanceProps {
  onEventClick: (date: Date, event: Event) => void;
}

export function WeekAtAGlance({ onEventClick }: WeekAtAGlanceProps) {
  const { user } = useAuth();
  const [todayEvents, setTodayEvents] = useState<Event[]>([]);

  useEffect(() => {
    if (!user) return;

    const loadEvents = async () => {
      try {
        const today = startOfDay(new Date());
        const dateStr = format(today, 'yyyy-MM-dd');
        const events = await DatabaseService.getEvents(user.id, dateStr, dateStr);

        const sortedEvents = events.sort((a, b) => {
          if (a.all_day && !b.all_day) return -1;
          if (!a.all_day && b.all_day) return 1;
          if (!a.time || !b.time) return 0;
          return a.time.localeCompare(b.time);
        });

        setTodayEvents(sortedEvents);
      } catch (error) {
        console.error('Failed to load events:', error);
      }
    };

    loadEvents();
  }, [user]);

  const getEventPosition = (time: string | null) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    return (totalMinutes / (24 * 60)) * 100;
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const today = new Date();

  return (
    <div className="week-at-a-glance">
      <h2 className="section-title">Today's Schedule</h2>
      <div className="today-schedule-card">
        <div className="schedule-header">
          <div className="schedule-date">
            <div className="date-day">{format(today, 'EEEE')}</div>
            <div className="date-number">{format(today, 'MMMM d, yyyy')}</div>
          </div>
          <div className="event-count">
            {todayEvents.length} {todayEvents.length === 1 ? 'event' : 'events'}
          </div>
        </div>

        <div className="schedule-timeline">
          <div className="timeline-hours">
            {hours.map(hour => (
              <div key={hour} className="hour-marker">
                <span className="hour-label">
                  {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                </span>
                <div className="hour-line" />
              </div>
            ))}
          </div>

          <div className="timeline-events">
            {todayEvents.length === 0 ? (
              <div className="no-events-message">
                No events scheduled for today
              </div>
            ) : (
              todayEvents.map(event => {
                const position = getEventPosition(event.time);
                return (
                  <button
                    key={event.id}
                    className="timeline-event"
                    style={position !== null ? { top: `${position}%` } : undefined}
                    onClick={() => onEventClick(today, event)}
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
  );
}
