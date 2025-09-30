import { format, addDays, subDays, startOfDay } from 'date-fns';
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
  const [dates, setDates] = useState<Date[]>([]);
  const [eventsMap, setEventsMap] = useState<Map<string, Event[]>>(new Map());

  useEffect(() => {
    const today = startOfDay(new Date());
    const generatedDates: Date[] = [];

    for (let i = -2; i <= 2; i++) {
      generatedDates.push(i < 0 ? subDays(today, Math.abs(i)) : addDays(today, i));
    }

    setDates(generatedDates);
  }, []);

  useEffect(() => {
    if (!user || dates.length === 0) return;

    const loadEvents = async () => {
      try {
        const startDate = format(dates[0], 'yyyy-MM-dd');
        const endDate = format(dates[dates.length - 1], 'yyyy-MM-dd');
        const events = await DatabaseService.getEvents(user.id, startDate, endDate);

        const eventsByDate = new Map<string, Event[]>();
        events.forEach(event => {
          const dateKey = event.date;
          if (!eventsByDate.has(dateKey)) {
            eventsByDate.set(dateKey, []);
          }
          eventsByDate.get(dateKey)!.push(event);
        });

        setEventsMap(eventsByDate);
      } catch (error) {
        console.error('Failed to load events:', error);
      }
    };

    loadEvents();
  }, [user, dates]);

  const isToday = (date: Date) => {
    const today = startOfDay(new Date());
    return startOfDay(date).getTime() === today.getTime();
  };

  return (
    <div className="week-at-a-glance">
      <h2 className="section-title">Week at a Glance</h2>
      <div className="week-dates">
        {dates.map((date, index) => {
          const dateKey = format(date, 'yyyy-MM-dd');
          const dayEvents = eventsMap.get(dateKey) || [];
          const today = isToday(date);

          return (
            <button
              key={index}
              className={`day-card ${today ? 'today' : ''}`}
              onClick={() => onDateClick(date)}
            >
              <div className="day-header">
                <div className="day-name">{format(date, 'EEE')}</div>
                <div className="day-number">{format(date, 'd')}</div>
                {today && <div className="today-badge">Today</div>}
              </div>

              <div className="day-events-list">
                {dayEvents.length === 0 ? (
                  <div className="no-events">No events</div>
                ) : (
                  dayEvents.slice(0, 3).map(event => (
                    <div key={event.id} className="event-item">
                      <div className="event-time">
                        {event.time ? format(new Date(`2000-01-01T${event.time}`), 'h:mm a') : 'All day'}
                      </div>
                      <div className="event-name">{event.name}</div>
                    </div>
                  ))
                )}
                {dayEvents.length > 3 && (
                  <div className="more-events">+{dayEvents.length - 3} more</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
