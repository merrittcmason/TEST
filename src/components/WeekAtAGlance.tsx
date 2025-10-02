import { format, startOfDay } from 'date-fns';
import { useEffect, useState } from 'react';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../lib/supabase';
import './WeekAtAGlance.css';

type Event = Database['public']['Tables']['events']['Row'];

interface WeekAtAGlanceProps {
  onDateClick: (date: Date) => void;
}

export function WeekAtAGlance({ onDateClick }: WeekAtAGlanceProps) {
  const { user } = useAuth();
  const [todayEvents, setTodayEvents] = useState<Event[]>([]);
  const [currentTimePosition, setCurrentTimePosition] = useState(0);
  const [visibleHours, setVisibleHours] = useState<number[]>([]);

  useEffect(() => {
    if (!user) return;

    const loadEvents = async () => {
      try {
        const today = startOfDay(new Date());
        const dateStr = format(today, 'yyyy-MM-dd');
        const events = await DatabaseService.getEvents(user.id, dateStr, dateStr);

        const sortedEvents = events.sort((a, b) => {
          if (a.all_day && !b.all_day) return 1;
          if (!a.all_day && b.all_day) return -1;
          if (!a.time || !b.time) return 0;
          return a.time.localeCompare(b.time);
        });

        setTodayEvents(sortedEvents);

        if (sortedEvents.length > 0) {
          const timedEvents = sortedEvents.filter(e => e.time);
          if (timedEvents.length > 0) {
            const firstTime = timedEvents[0].time!;
            const lastTime = timedEvents[timedEvents.length - 1].time!;
            const firstHour = parseInt(firstTime.split(':')[0]);
            const lastHour = parseInt(lastTime.split(':')[0]);
            const startHour = Math.max(0, firstHour - 1);
            const endHour = Math.min(23, lastHour + 2);
            setVisibleHours(Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i));
          } else {
            setVisibleHours(Array.from({ length: 24 }, (_, i) => i));
          }
        } else {
          setVisibleHours(Array.from({ length: 24 }, (_, i) => i));
        }
      } catch (error) {
        console.error('Failed to load events:', error);
      }
    };

    loadEvents();
  }, [user]);

  useEffect(() => {
    const updateCurrentTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const totalMinutes = hours * 60 + minutes;
      const position = (totalMinutes / (24 * 60)) * 100;
      setCurrentTimePosition(position);
    };

    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000);
    return () => clearInterval(interval);
  }, []);

  const getEventPosition = (time: string | null) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    return (totalMinutes / (24 * 60)) * 100;
  };

  const today = new Date();

  return (
    <div className="week-at-a-glance">
      <h2 className="section-title">Today's Events</h2>
      <div className="today-schedule-card">
        <button className="schedule-header" onClick={() => onDateClick(today)}>
          <div className="schedule-date">
            <div className="date-day">{format(today, 'EEEE')}</div>
            <div className="date-number">{format(today, 'MMMM d, yyyy')}</div>
          </div>
          <div className="event-count">
            {todayEvents.length} {todayEvents.length === 1 ? 'event' : 'events'}
          </div>
        </button>

        <div className="schedule-timeline-compact">
          <div className="timeline-hours-compact">
            {visibleHours.map(hour => (
              <div key={hour} className="hour-marker-compact">
                <span className="hour-label-compact">
                  {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                </span>
                <div className="hour-line-compact" />
              </div>
            ))}
            <div
              className="current-time-indicator"
              style={{ top: `${currentTimePosition}%` }}
            >
              <div className="current-time-line" />
              <div className="current-time-dot" />
            </div>
          </div>

          <div className="timeline-events-compact">
            {todayEvents.length === 0 ? (
              <div className="no-events-message">
                No events scheduled for today
              </div>
            ) : (
              todayEvents.map(event => {
                const position = getEventPosition(event.time);
                return (
                  <div
                    key={event.id}
                    className="timeline-event-compact"
                    style={position !== null ? { top: `${position}%` } : undefined}
                  >
                    <div className="event-time-badge">
                      {event.time ? format(new Date(`2000-01-01T${event.time}`), 'h:mm a') : 'All day'}
                    </div>
                    <div className="event-name-display">{event.name}</div>
                    {event.tag && <div className="event-tag-badge">{event.tag}</div>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
