import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, addMonths, subMonths } from 'date-fns';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../lib/supabase';
import './CalendarView.css';

type Event = Database['public']['Tables']['events']['Row'];

interface CalendarViewProps {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  onEventClick: (event: Event) => void;
}

export function CalendarView({ selectedDate, onDateSelect, onEventClick }: CalendarViewProps) {
  const { user } = useAuth();
  const [currentMonth, setCurrentMonth] = useState(selectedDate);
  const [events, setEvents] = useState<Event[]>([]);
  const [view, setView] = useState<'month' | 'week' | 'day'>('month');

  useEffect(() => {
    if (!user) return;

    const loadEvents = async () => {
      try {
        const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
        const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
        const loadedEvents = await DatabaseService.getEvents(user.id, start, end);
        setEvents(loadedEvents);
      } catch (error) {
        console.error('Failed to load events:', error);
      }
    };

    loadEvents();
  }, [user, currentMonth]);

  const getDaysInMonth = () => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start, end });
  };

  const getEventsForDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return events.filter(event => event.date === dateStr);
  };

  const handlePrevMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    onDateSelect(today);
  };

  const days = getDaysInMonth();

  return (
    <div className="calendar-view">
      <div className="calendar-header">
        <div className="calendar-nav">
          <button onClick={handlePrevMonth} className="btn btn-secondary nav-btn">
            ←
          </button>
          <h2 className="calendar-month-title">
            {format(currentMonth, 'MMMM yyyy')}
          </h2>
          <button onClick={handleNextMonth} className="btn btn-secondary nav-btn">
            →
          </button>
        </div>

        <div className="calendar-controls">
          <button onClick={handleToday} className="btn btn-secondary">
            Today
          </button>
          <div className="view-switcher">
            <button
              className={`view-btn ${view === 'month' ? 'active' : ''}`}
              onClick={() => setView('month')}
            >
              Month
            </button>
            <button
              className={`view-btn ${view === 'week' ? 'active' : ''}`}
              onClick={() => setView('week')}
            >
              Week
            </button>
            <button
              className={`view-btn ${view === 'day' ? 'active' : ''}`}
              onClick={() => setView('day')}
            >
              Day
            </button>
          </div>
        </div>
      </div>

      {view === 'month' && (
        <div className="calendar-grid">
          <div className="calendar-weekdays">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="calendar-weekday">
                {day}
              </div>
            ))}
          </div>

          <div className="calendar-days">
            {days.map((day, index) => {
              const dayEvents = getEventsForDate(day);
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isToday = isSameDay(day, new Date());
              const isSelected = isSameDay(day, selectedDate);

              return (
                <button
                  key={index}
                  className={`calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                  onClick={() => onDateSelect(day)}
                >
                  <span className="day-number">{format(day, 'd')}</span>
                  {dayEvents.length > 0 && (
                    <div className="day-events">
                      {dayEvents.slice(0, 3).map(event => (
                        <div
                          key={event.id}
                          className="day-event"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEventClick(event);
                          }}
                        >
                          {event.name}
                        </div>
                      ))}
                      {dayEvents.length > 3 && (
                        <div className="day-event-more">
                          +{dayEvents.length - 3} more
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(view === 'week' || view === 'day') && (
        <div className="calendar-message">
          {view === 'week' ? 'Week' : 'Day'} view coming soon!
        </div>
      )}
    </div>
  );
}
