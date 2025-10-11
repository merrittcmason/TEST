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
  const [visibleHours, setVisibleHours] = useState<number[]>([]);
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [currentTimePosition, setCurrentTimePosition] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    const loadEvents = async () => {
      try {
        const today = startOfDay(new Date());
        const dateStr = format(today, 'yyyy-MM-dd');
        const events = await DatabaseService.getEvents(user.id, dateStr, dateStr);
        const sorted = events.sort((a, b) => {
          if (a.all_day && !b.all_day) return 1;
          if (!a.all_day && b.all_day) return -1;
          if (!a.time || !b.time) return 0;
          return a.time.localeCompare(b.time);
        });
        setTodayEvents(sorted);
        const timed = sorted.filter(e => e.time);
        if (timed.length > 0) {
          const first = timed[0].time as string;
          const last = timed[timed.length - 1].time as string;
          const [fh, fm] = first.split(':').map(Number);
          const [lh, lm] = last.split(':').map(Number);
          const startMin = fh * 60 + fm;
          const endMin = lh * 60 + lm;
          setRangeStart(startMin);
          setRangeEnd(endMin);
          const startHour = Math.floor(startMin / 60);
          const endHour = Math.ceil(endMin / 60);
          setVisibleHours(Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i));
        } else {
          setRangeStart(null);
          setRangeEnd(null);
          setVisibleHours([]);
        }
      } catch (error) {
        console.error('Failed to load events:', error);
      }
    };
    loadEvents();
  }, [user]);

  useEffect(() => {
    const updateCurrentTime = () => {
      if (rangeStart === null || rangeEnd === null || rangeEnd <= rangeStart) {
        setCurrentTimePosition(null);
        return;
      }
      const now = new Date();
      const total = now.getHours() * 60 + now.getMinutes();
      if (total < rangeStart || total > rangeEnd) {
        setCurrentTimePosition(null);
        return;
      }
      const span = Math.max(1, rangeEnd - rangeStart);
      const pct = ((total - rangeStart) / span) * 100;
      setCurrentTimePosition(pct);
    };
    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000);
    return () => clearInterval(interval);
  }, [rangeStart, rangeEnd]);

  const getEventPosition = (time: string | null) => {
    if (!time || rangeStart === null || rangeEnd === null || rangeEnd <= rangeStart) return null;
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m;
    const span = Math.max(1, rangeEnd - rangeStart);
    return ((total - rangeStart) / span) * 100;
  };

  const today = new Date();
  const timedEvents = todayEvents.filter(e => e.time);
  const showTimeline = timedEvents.length > 0;

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
          {showTimeline ? (
            <>
              <div className="timeline-hours-compact">
                {visibleHours.map(hour => (
                  <div key={hour} className="hour-marker-compact">
                    <span className="hour-label-compact">
                      {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                    </span>
                    <div className="hour-line-compact" />
                  </div>
                ))}
                {currentTimePosition !== null && (
                  <div className="current-time-indicator" style={{ top: `${currentTimePosition}%` }}>
                    <div className="current-time-line" />
                    <div className="current-time-dot" />
                  </div>
                )}
              </div>

              <div className="timeline-events-compact">
                {timedEvents.map(event => {
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
                })}
              </div>
            </>
          ) : (
            <div className="no-events-message">No timed events for today</div>
          )}
        </div>
      </div>
    </div>
  );
}
