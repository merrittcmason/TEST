import { useState, useEffect, useRef } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay } from 'date-fns';
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
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [showDayDetail, setShowDayDetail] = useState(false);
  const [dayEvents, setDayEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [editForm, setEditForm] = useState({ name: '', date: '', time: '', tag: '', all_day: false });
  const [saving, setSaving] = useState(false);
  const [showSelector, setShowSelector] = useState(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user) return;
    const loadEvents = async () => {
      try {
        const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
        const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
        const loadedEvents = await DatabaseService.getEvents(user.id, start, end);
        const uniqueTags = Array.from(new Set(loadedEvents.map(e => (e.tag || '').trim()).filter((t): t is string => !!t))).sort((a, b) => a.localeCompare(b));
        setAvailableTags(uniqueTags);
        if (selectedTag) {
          setEvents(loadedEvents.filter(e => (e.tag || '').trim() === selectedTag));
        } else {
          setEvents(loadedEvents);
        }
      } catch {}
    };
    loadEvents();
  }, [user, currentMonth, selectedTag]);

  useEffect(() => {
    if (!user || !showDayDetail) return;
    const loadDayEvents = async () => {
      try {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const evts = await DatabaseService.getEvents(user.id, dateStr, dateStr);
        const sorted = evts.sort((a, b) => {
          if (a.all_day && !b.all_day) return 1;
          if (!a.all_day && b.all_day) return -1;
          if (!a.time || !b.time) return 0;
          return a.time.localeCompare(b.time);
        });
        setDayEvents(sorted);
      } catch {}
    };
    loadDayEvents();
  }, [user, selectedDate, showDayDetail]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!selectorRef.current) return;
      if (!selectorRef.current.contains(e.target as Node)) setShowSelector(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const getDaysInMonth = () => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const startGrid = new Date(start);
    startGrid.setDate(start.getDate() - start.getDay());
    const endGrid = new Date(end);
    endGrid.setDate(end.getDate() + (6 - end.getDay()));
    return eachDayOfInterval({ start: startGrid, end: endGrid });
  };

  const getEventsForDate = (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return events.filter(event => event.date === dateStr);
  };

  const handlePrevMonth = () => {
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    setCurrentMonth(new Date(y, m - 1, 1));
  };

  const handleNextMonth = () => {
    const y = currentMonth.getFullYear();
    const m = currentMonth.getMonth();
    setCurrentMonth(new Date(y, m + 1, 1));
  };

  const handleMonthYearChange = (year: number, month: number) => {
    setCurrentMonth(new Date(year, month, 1));
  };

  const handleDayClick = (day: Date) => {
    onDateSelect(day);
    setShowDayDetail(true);
  };

  const handleEditEvent = (event: Event) => {
    setEditingEvent(event);
    setEditForm({
      name: event.name,
      date: event.date,
      time: event.time || '',
      tag: event.tag || '',
      all_day: event.all_day || false,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingEvent) return;
    setSaving(true);
    try {
      await DatabaseService.updateEvent(editingEvent.id, {
        name: editForm.name,
        date: editForm.date,
        time: editForm.time || null,
        tag: editForm.tag || null,
        all_day: editForm.all_day,
      });
      setEditingEvent(null);
      if (showDayDetail) {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const evts = await DatabaseService.getEvents(user!.id, dateStr, dateStr);
        const sorted = evts.sort((a, b) => {
          if (a.all_day && !b.all_day) return 1;
          if (!a.all_day && b.all_day) return -1;
          if (!a.time || !b.time) return 0;
          return a.time.localeCompare(b.time);
        });
        setDayEvents(sorted);
      }
    } catch {
      alert('Failed to update event');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!editingEvent) return;
    if (!confirm('Are you sure you want to delete this event?')) return;
    setSaving(true);
    try {
      await DatabaseService.deleteEvent(editingEvent.id);
      setEditingEvent(null);
      if (showDayDetail) {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const evts = await DatabaseService.getEvents(user!.id, dateStr, dateStr);
        const sorted = evts.sort((a, b) => {
          if (a.all_day && !b.all_day) return 1;
          if (!a.all_day && b.all_day) return -1;
          if (!a.time || !b.time) return 0;
          return a.time.localeCompare(b.time);
        });
        setDayEvents(sorted);
      }
    } catch {
      alert('Failed to delete event');
    } finally {
      setSaving(false);
    }
  };

  const days = getDaysInMonth();
  const years = Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i);
  const months = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div className="calendar-view">
      <div className="calendar-header">
        <div className="calendar-top-row">
          <div className="calendar-side-left">
            <button onClick={handlePrevMonth} className="btn btn-secondary nav-btn" aria-label="Previous month">←</button>
            <div className="side-filter">
              <select
                className="label-filter"
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                aria-label="Filter by tag"
              >
                <option value="">All Tags</option>
                {availableTags.length === 0 ? (
                  <option disabled>No tags yet</option>
                ) : (
                  availableTags.map(tag => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="calendar-center" ref={selectorRef}>
            <button
              className="calendar-title-button"
              onClick={() => setShowSelector(v => !v)}
              aria-haspopup="listbox"
              aria-expanded={showSelector}
              aria-label="Open month and year selector"
            >
              <div className="calendar-title-month">{format(currentMonth, 'MMMM')}</div>
              <div className="calendar-title-year">{format(currentMonth, 'yyyy')}</div>
              <div className="calendar-title-caret">▾</div>
            </button>
            {showSelector && (
              <div className="monthyear-dropdown" role="listbox">
                <div className="dropdown-section">
                  <label className="dropdown-label">Month</label>
                  <select
                    className="dropdown-select"
                    value={currentMonth.getMonth()}
                    onChange={(e) => handleMonthYearChange(currentMonth.getFullYear(), parseInt(e.target.value))}
                    aria-label="Select month"
                  >
                    {months.map(m => (
                      <option key={m} value={m}>{format(new Date(2000, m, 1), 'MMMM')}</option>
                    ))}
                  </select>
                </div>
                <div className="dropdown-section">
                  <label className="dropdown-label">Year</label>
                  <select
                    className="dropdown-select"
                    value={currentMonth.getFullYear()}
                    onChange={(e) => handleMonthYearChange(parseInt(e.target.value), currentMonth.getMonth())}
                    aria-label="Select year"
                  >
                    {years.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="calendar-side-right">
            <button onClick={handleNextMonth} className="btn btn-secondary nav-btn" aria-label="Next month">→</button>
          </div>
        </div>
      </div>

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
            const dayEventsForDate = getEventsForDate(day);
            const isCurrentMonth = isSameMonth(day, currentMonth);
            const isToday = isSameDay(day, new Date());
            return (
              <button
                key={index}
                className={`calendar-day ${!isCurrentMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}`}
                onClick={() => handleDayClick(day)}
              >
                <span className="day-number">{format(day, 'd')}</span>
                {dayEventsForDate.length > 0 && (
                  <div className="day-events">
                    {dayEventsForDate.slice(0, 3).map(event => (
                      <div
                        key={event.id}
                        className="day-event"
                        title={event.label ? `Label: ${event.label}` : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEvent(event);
                          onEventClick(event);
                        }}
                      >
                        {event.name}
                      </div>
                    ))}
                    {dayEventsForDate.length > 3 && (
                      <div className="day-event-more">
                        +{dayEventsForDate.length - 3} more
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {showDayDetail && (
        <div className="day-detail-overlay" onClick={() => setShowDayDetail(false)}>
          <div className="day-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="day-detail-header">
              <div>
                <h2 className="day-detail-title">{format(selectedDate, 'EEEE')}</h2>
                <p className="day-detail-date">{format(selectedDate, 'MMMM d, yyyy')}</p>
              </div>
              <button className="day-detail-close" onClick={() => setShowDayDetail(false)}>✕</button>
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
                      <button className="btn-icon" onClick={() => setSelectedEvent(event)} title="View details">
                        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                      <button className="btn-icon" onClick={() => handleEditEvent(event)} title="Edit event">
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
              <p><strong>Date:</strong> {selectedEvent.date}</p>
              {selectedEvent.time && <p><strong>Time:</strong> {selectedEvent.time}</p>}
              {selectedEvent.tag && <p><strong>Tag:</strong> {selectedEvent.tag}</p>}
            </div>
            <button onClick={() => setSelectedEvent(null)} className="btn btn-primary">Close</button>
          </div>
        </div>
      )}

      {editingEvent && (
        <div className="event-modal-overlay" onClick={() => !saving && setEditingEvent(null)}>
          <div className="event-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="edit-modal-header">
              <h3>Edit Event</h3>
              <button className="modal-close" onClick={() => setEditingEvent(null)}>✕</button>
            </div>

            <div className="edit-form">
              <div className="form-group">
                <label htmlFor="edit-name">Event Name</label>
                <input
                  id="edit-name"
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="Event name"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="edit-date">Date</label>
                  <input
                    id="edit-date"
                    type="date"
                    value={editForm.date}
                    onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="edit-time">Time</label>
                  <input
                    id="edit-time"
                    type="time"
                    value={editForm.time}
                    onChange={(e) => setEditForm({ ...editForm, time: e.target.value })}
                    disabled={editForm.all_day}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="edit-tag">Tag</label>
                <input
                  id="edit-tag"
                  type="text"
                  value={editForm.tag}
                  onChange={(e) => setEditForm({ ...editForm, tag: e.target.value })}
                  placeholder="Optional tag"
                />
              </div>

              <div className="form-group-checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={editForm.all_day}
                    onChange={(e) => setEditForm({ ...editForm, all_day: e.target.checked, time: e.target.checked ? '' : editForm.time })}
                  />
                  All day event
                </label>
              </div>

              <div className="edit-actions">
                <button onClick={handleDeleteEvent} className="btn btn-danger" disabled={saving}>
                  {saving ? 'Deleting...' : 'Delete'}
                </button>
                <div className="edit-actions-right">
                  <button onClick={() => setEditingEvent(null)} className="btn btn-secondary" disabled={saving}>
                    Cancel
                  </button>
                  <button onClick={handleSaveEdit} className="btn btn-primary" disabled={saving || !editForm.name || !editForm.date}>
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
