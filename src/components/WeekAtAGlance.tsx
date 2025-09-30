import { format, addDays, subDays, startOfDay } from 'date-fns';
import { useEffect, useState, useRef } from 'react';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import './WeekAtAGlance.css';

interface WeekAtAGlanceProps {
  onDateClick: (date: Date) => void;
}

export function WeekAtAGlance({ onDateClick }: WeekAtAGlanceProps) {
  const { user } = useAuth();
  const [dates, setDates] = useState<Date[]>([]);
  const [eventCounts, setEventCounts] = useState<Map<string, number>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const today = startOfDay(new Date());
    const generatedDates: Date[] = [];

    for (let i = -3; i <= 14; i++) {
      generatedDates.push(i < 0 ? subDays(today, Math.abs(i)) : addDays(today, i));
    }

    setDates(generatedDates);

    if (scrollRef.current) {
      const todayIndex = 3;
      const dayWidth = 80;
      scrollRef.current.scrollLeft = (todayIndex - 1) * dayWidth;
    }
  }, []);

  useEffect(() => {
    if (!user || dates.length === 0) return;

    const loadEventCounts = async () => {
      try {
        const startDate = format(dates[0], 'yyyy-MM-dd');
        const endDate = format(dates[dates.length - 1], 'yyyy-MM-dd');
        const events = await DatabaseService.getEvents(user.id, startDate, endDate);

        const counts = new Map<string, number>();
        events.forEach(event => {
          const dateKey = event.date;
          counts.set(dateKey, (counts.get(dateKey) || 0) + 1);
        });

        setEventCounts(counts);
      } catch (error) {
        console.error('Failed to load event counts:', error);
      }
    };

    loadEventCounts();
  }, [user, dates]);

  const isToday = (date: Date) => {
    const today = startOfDay(new Date());
    return startOfDay(date).getTime() === today.getTime();
  };

  return (
    <div className="week-at-a-glance">
      <div className="week-scroll-container" ref={scrollRef}>
        <div className="week-dates">
          {dates.map((date, index) => {
            const dateKey = format(date, 'yyyy-MM-dd');
            const count = eventCounts.get(dateKey) || 0;
            const today = isToday(date);

            return (
              <button
                key={index}
                className={`day-card ${today ? 'today' : ''}`}
                onClick={() => onDateClick(date)}
              >
                <div className="day-name">{format(date, 'EEE')}</div>
                <div className="day-number">{format(date, 'd')}</div>
                {count > 0 && (
                  <div className="event-indicator">
                    {count} {count === 1 ? 'event' : 'events'}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
