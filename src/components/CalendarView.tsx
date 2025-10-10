import { useState, useEffect, useRef } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay } from 'date-fns';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../lib/supabase';
import './CalendarView.css';
import { fromUTC } from '../utils/timeUtils';
import { createPortal } from 'react-dom';

type Event = Database['public']['Tables']['events']['Row'];

interface CalendarViewProps {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  onEventClick: (event: Event) => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

export function CalendarView({ selectedDate, onDateSelect, onEventClick, onModalOpen, onModalClose }: CalendarViewProps) {
  const { user } = useAuth();
  const [userPrefs, setUserPrefs] = useState<{ timezone_preference: string | null; time_format_preference: string | null } | null>(null);
  const [currentMonth, setCurrentMonth] = useState(selectedDate);
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [showDayDetail, setShowDayDetail] = useState(false);
  const [dayEvents, setDayEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    start_date: '',
    start_time: '',
    end_date: '',
    end_time: '',
    all_day: false,
    location: '',
    label: '',
    tag: '',
    description: ''
  });
  const [saving, setSaving] = useState(false);
  const [showSelector, setShowSelector] = useState(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user) return;
    const loadEvents = async () => {
      try {
        const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
        const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');
        const loaded = await DatabaseService.getEvents(user.id, start, end);
        const uniqueTags = Array.from(new Set(loaded.map((e: Event) => (e.tag || '').trim()).filter((t: string): t is string => !!t))).sort((a: string, b: string) => a.localeCompare(b));
        setAvailableTags(uniqueTags);
        setEvents(selectedTag ? loaded.filter((e: Event) => (e.tag || '').trim() === selectedTag) : loaded);
      } catch {}
    };
    loadEvents();
  }, [user, currentMonth, selectedTag]);

  useEffect(() => {
    if (!user) return;
    const loadPrefs = async () => {
      const prefs = await DatabaseService.getUserPreferences(user.id);
      setUserPrefs(prefs);
    };
    loadPrefs();
  }, [user]);

  useEffect(() => {
    if (!user || !showDayDetail) return;
    const loadDay = async () => {
      try {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const evts: Event[] = await DatabaseService.getEvents(user.id, dateStr, dateStr);
        const sorted = evts.sort((a, b) => {
          if (a.all_day && !b.all_day) return 1;
          if (!a.all_day && b.all_day) return -1;
          if (!a.start_time || !b.start_time) return 0;
          return a.start_time.localeCompare(b.start_time);
        });
        setDayEvents(sorted);
      } catch {}
    };
    loadDay();
  }, [user, selectedDate, showDayDetail]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!selectorRef.current) return;
      if (!selectorRef.current.contains(e.target as Node)) setShowSelector(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    const anyModalOpen = showDayDetail || !!selectedEvent || !!editingEvent;
    if (anyModalOpen) onModalOpen?.();
    else onModalClose?.();
  }, [showDayDetail, selectedEvent, editingEvent, onModalOpen, onModalClose]);

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
    return events.filter(event => event.start_date === dateStr || event.end_date === dateStr);
  };

  const timeRange = (e: Event) => {
    if (e.all_day) return 'All day';
    const tz = userPrefs?.timezone_preference || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const use24h = userPrefs?.time_format_preference === '24';
    const fmtIs12 = userPrefs?.time_format_preference === '12';
    const hour12 = fmtIs12 ? true : use24h ? false : undefined;
    if (e.start_time && e.end_time) {
      const s = fromUTC(e.start_date, e.start_time, tz).localTime;
      const en = fromUTC(e.end_date || e.start_date, e.end_time, tz).localTime;
      return `${formatDisplayTime(s, hour12)} – ${formatDisplayTime(en, hour12)}`;
    }
    if (e.start_time) {
      const s = fromUTC(e.start_date, e.start_time, tz).localTime;
      return formatDisplayTime(s, hour12);
    }
    return '';
  };

  function formatDisplayTime(time: string | null, hour12: boolean | undefined) {
    if (!time) return '';
    const [h, m] = time.split(':');
    const d = new Date(2000, 0, 1, parseInt(h), parseInt(m));
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12
    }).format(d);
  }

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
      title: event.title || '',
      start_date: event.start_date || '',
      start_time: event.start_time || '',
      end_date: event.end_date || '',
      end_time: event.end_time || '',
      all_day: event.all_day || false,
      location: event.location || '',
      label: event.label || '',
      tag: event.tag || '',
      description: event.description || ''
    });
  };

  const handleSaveEdit = async () => {
    if (!editingEvent) return;
    setSaving(true);
    try {
      await DatabaseService.updateEvent(editingEvent.id, {
        title: editForm.title,
        start_date: editForm.start_date,
        start_time: editForm.all_day ? null : editForm.start_time || null,
        end_date: editForm.end_date,
        end_time: editForm.all_day ? null : editForm.end_time || null,
        all_day: editForm.all_day,
        location: editForm.location || null,
        label: editForm.label || null,
        tag: editForm.tag || null,
        description: editForm.description || null
      });
      setEditingEvent(null);
      if (showDayDetail) {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const evts: Event[] = await DatabaseService.getEvents(user!.id, dateStr, dateStr);
        const sorted = evts.sort((a, b) => {
          if (a.all_day && !b.all_day) return 1;
          if (!a.all_day && b.all_day) return -1;
          if (!a.start_time || !b.start_time) return 0;
          return a.start_time.localeCompare(b.start_time);
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
    if (!confirm('Delete this event?')) return;
    setSaving(true);
    try {
      await DatabaseService.deleteEvent(editingEvent.id);
      setEditingEvent(null);
      if (showDayDetail) {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const evts: Event[] = await DatabaseService.getEvents(user!.id, dateStr, dateStr);
        const sorted = evts.sort((a, b) => {
          if (a.all_day && !b.all_day) return 1;
          if (!a.all_day && b.all_day) return -1;
          if (!a.start_time || !b.start_time) return 0;
          return a.start_time.localeCompare(b.start_time);
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
                        {event.title}
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

      {showDayDetail &&
        createPortal(
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
                        <div className="event-card-time">{timeRange(event)}</div>
                        <div className="event-card-details">
                          <div className="event-card-name">{event.title}</div>
                          <div className="event-card-sub">
                            {event.location && <span className="event-card-location">{event.location}</span>}
                            {event.label && <span className="event-card-label">{event.label}</span>}
                            {event.tag && <span className="event-card-tag">{event.tag}</span>}
                          </div>
                          {event.description && <div className="event-card-desc">{event.description}</div>}
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
          </div>,
          document.body
        )}

      {selectedEvent &&
        createPortal(
          <div className="event-modal-overlay" onClick={() => setSelectedEvent(null)}>
            <div className="event-modal" onClick={(e) => e.stopPropagation()}>
              <h3>{selectedEvent.title}</h3>
              <div className="event-details">
                <p><strong>Date:</strong> {selectedEvent.start_date}{selectedEvent.end_date && selectedEvent.end_date !== selectedEvent.start_date ? ` – ${selectedEvent.end_date}` : ''}</p>
                {!selectedEvent.all_day && <p><strong>Time:</strong> {timeRange(selectedEvent)}</p>}
                {selectedEvent.location && <p><strong>Location:</strong> {selectedEvent.location}</p>}
                {selectedEvent.label && <p><strong>Label:</strong> {selectedEvent.label}</p>}
                {selectedEvent.tag && <p><strong>Tag:</strong> {selectedEvent.tag}</p>}
                {selectedEvent.description && <p><strong>Description:</strong> {selectedEvent.description}</p>}
              </div>
              <button onClick={() => setSelectedEvent(null)} className="btn btn-primary">Close</button>
            </div>
          </div>,
          document.body
        )}

      {editingEvent &&
        createPortal(
          <div className="event-modal-overlay" onClick={() => !saving && setEditingEvent(null)}>
            <div className="event-edit-modal" onClick={(e) => e.stopPropagation()}>
              <div className="edit-modal-header">
                <h3>Edit Event</h3>
                <button className="modal-close" onClick={() => setEditingEvent(null)}>✕</button>
              </div>
              <div className="edit-form">
                <div className="form-group">
                  <label htmlFor="edit-title">Title</label>
                  <input
                    id="edit-title"
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    placeholder="Event title"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit-location">Location</label>
                  <input
                    id="edit-location"
                    type="text"
                    value={editForm.location}
                    onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                    placeholder="Online or building/room"
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="edit-start-date">Start date</label>
                    <input
                      id="edit-start-date"
                      type="date"
                      value={editForm.start_date}
                      onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="edit-start-time">Start time</label>
                    <input
                      id="edit-start-time"
                      type="time"
                      value={editForm.start_time}
                      onChange={(e) => setEditForm({ ...editForm, start_time: e.target.value })}
                      disabled={editForm.all_day}
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="edit-end-date">End date</label>
                    <input
                      id="edit-end-date"
                      type="date"
                      value={editForm.end_date}
                      onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="edit-end-time">End time</label>
                    <input
                      id="edit-end-time"
                      type="time"
                      value={editForm.end_time}
                      onChange={(e) => setEditForm({ ...editForm, end_time: e.target.value })}
                      disabled={editForm.all_day}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="edit-label">Label</label>
                  <input
                    id="edit-label"
                    type="text"
                    value={editForm.label}
                    onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                    placeholder="e.g., CS101"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit-tag">Tag</label>
                  <input
                    id="edit-tag"
                    type="text"
                    value={editForm.tag}
                    onChange={(e) => setEditForm({ ...editForm, tag: e.target.value })}
                    placeholder="e.g., Class, Meeting"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit-description">Description</label>
                  <textarea
                    id="edit-description"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="Details"
                  />
                </div>
                <div className="form-group-checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={editForm.all_day}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          all_day: e.target.checked,
                          start_time: e.target.checked ? '' : editForm.start_time,
                          end_time: e.target.checked ? '' : editForm.end_time
                        })
                      }
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
                    <button
                      onClick={handleSaveEdit}
                      className="btn btn-primary"
                      disabled={saving || !editForm.title || !editForm.start_date || !editForm.end_date}
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
