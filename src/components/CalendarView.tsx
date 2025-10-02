import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, startOfWeek, endOfWeek, addMonths, subMonths, addWeeks, subWeeks } from 'date-fns';
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
  const [currentWeek, setCurrentWeek] = useState(selectedDate);
  const [events, setEvents] = useState<Event[]>([]);
  const [view, setView] = useState<'month' | 'week'>('month');
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);
  const [showMonthYearPicker, setShowMonthYearPicker] = useState(false);

  useEffect(() => {
    if (!user) return;

    const loadEvents = async () => {
      try {
        let start, end;
        if (view === 'week') {
          start = format(startOfWeek(currentWeek), 'yyyy-MM-dd');
          end = format(endOfWeek(currentWeek), 'yyyy-MM-dd');
        } else {
          start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
          end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
        }
        const loadedEvents = await DatabaseService.getEvents(user.id, start, end);

        const uniqueLabels = Array.from(
          new Set(loadedEvents.map(e => (e as any).label).filter((label): label is string => label !== null && label !== ''))
        );
        setAvailableLabels(uniqueLabels);

        if (selectedLabel) {
          setEvents(loadedEvents.filter(e => (e as any).label === selectedLabel));
        } else {
          setEvents(loadedEvents);
        }
      } catch (error) {
        console.error('Failed to load events:', error);
      }
    };

    loadEvents();
  }, [user, currentMonth, currentWeek, view, selectedLabel]);

  const getDaysInMonth = () => {
    const start = startOfWeek(startOfMonth(currentMonth));
    const end = endOfWeek(endOfMonth(currentMonth));
    return eachDayOfInterval({ start, end });
  };

  const getEventsForDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return events.filter(event => event.date === dateStr);
  };

  const handlePrev = () => {
    if (view === 'week') {
      setCurrentWeek(subWeeks(currentWeek, 1));
    } else {
      setCurrentMonth(subMonths(currentMonth, 1));
    }
  };

  const handleNext = () => {
    if (view === 'week') {
      setCurrentWeek(addWeeks(currentWeek, 1));
    } else {
      setCurrentMonth(addMonths(currentMonth, 1));
    }
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    setCurrentWeek(today);
    onDateSelect(today);
  };

  const handleMonthYearChange = (year: number, month: number) => {
    const newDate = new Date(year, month, 1);
    setCurrentMonth(newDate);
    setShowMonthYearPicker(false);
  };

  const getWeekDays = () => {
    const start = startOfWeek(currentWeek);
    const end = endOfWeek(currentWeek);
    return eachDayOfInterval({ start, end });
  };

  const getWeekEventsForDay = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return events.filter(event => event.date === dateStr);
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);

  const days = getDaysInMonth();

  return (
    <div className="calendar-view">
      <div className="calendar-header">
        <div className="calendar-top-row">
          <div className="calendar-nav">
            <button onClick={handlePrev} className="btn btn-secondary nav-btn">
              ←
            </button>
            <button
              className="calendar-month-title-btn"
              onClick={() => setShowMonthYearPicker(!showMonthYearPicker)}
            >
              {view === 'week'
                ? `${format(startOfWeek(currentWeek), 'MMM d')} - ${format(endOfWeek(currentWeek), 'MMM d, yyyy')}`
                : format(currentMonth, 'MMMM yyyy')}
            </button>
            <button onClick={handleNext} className="btn btn-secondary nav-btn">
              →
            </button>
          </div>

          <div className="calendar-controls">
            <select
              className="label-filter"
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
            >
              <option value="">All Labels</option>
              {availableLabels.length === 0 ? (
                <option disabled>You haven't created any labels yet</option>
              ) : (
                availableLabels.map(label => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))
              )}
            </select>

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
            </div>
          </div>
        </div>

        {showMonthYearPicker && (
          <div className="month-year-picker">
            <select
              value={currentMonth.getFullYear()}
              onChange={(e) => handleMonthYearChange(parseInt(e.target.value), currentMonth.getMonth())}
            >
              {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i).map(year => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <select
              value={currentMonth.getMonth()}
              onChange={(e) => handleMonthYearChange(currentMonth.getFullYear(), parseInt(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i).map(month => (
                <option key={month} value={month}>
                  {format(new Date(2000, month, 1), 'MMMM')}
                </option>
              ))}
            </select>
          </div>
        )}
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

      {view === 'week' && (
        <div className="week-view">
          <div className="week-grid">
            <div className="week-time-column">
              <div className="week-time-header"></div>
              {hours.map(hour => (
                <div key={hour} className="week-hour-label">
                  {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                </div>
              ))}
            </div>
            {getWeekDays().map((day, dayIndex) => (
              <div key={dayIndex} className="week-day-column">
                <div className="week-day-header">
                  <div className="week-day-name">{format(day, 'EEE')}</div>
                  <div className={`week-day-number ${isSameDay(day, new Date()) ? 'today' : ''}`}>
                    {format(day, 'd')}
                  </div>
                </div>
                <div className="week-hours-container">
                  {hours.map(hour => (
                    <div key={hour} className="week-hour-cell"></div>
                  ))}
                  <div className="week-events-overlay">
                    {getWeekEventsForDay(day).map(event => {
                      const time = event.time || '00:00';
                      const [hours, minutes] = time.split(':').map(Number);
                      const topPercent = ((hours * 60 + minutes) / (24 * 60)) * 100;
                      return (
                        <div
                          key={event.id}
                          className="week-event"
                          style={{ top: `${topPercent}%` }}
                          onClick={() => onEventClick(event)}
                        >
                          <div className="week-event-time">
                            {event.time ? format(new Date(`2000-01-01T${event.time}`), 'h:mm a') : 'All day'}
                          </div>
                          <div className="week-event-name">{event.name}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
