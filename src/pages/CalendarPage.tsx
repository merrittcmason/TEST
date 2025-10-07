import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { CalendarView } from '../components/CalendarView';
import { HamburgerMenu } from '../components/HamburgerMenu';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { useMode, MODE_CONFIG } from '../contexts/ModeContext';
import type { Database } from '../lib/supabase';
import './CalendarPage.css';

type Event = Database['public']['Tables']['events']['Row'];

interface CalendarPageProps {
  initialDate?: Date;
  selectedEvent?: Event | null;
  onNavigate: (page: string) => void;
}

export function CalendarPage({ initialDate, selectedEvent: initialEvent, onNavigate }: CalendarPageProps) {
  const { user } = useAuth();
  const { mode } = useMode();
  const [selectedDate, setSelectedDate] = useState(initialDate || new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(initialEvent || null);
  const [showDayDetail, setShowDayDetail] = useState(!!initialEvent);
  const [dayEvents, setDayEvents] = useState<Event[]>([]);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [editForm, setEditForm] = useState({ name: '', date: '', time: '', tag: '', all_day: false });
  const [saving, setSaving] = useState(false);

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
        const events = await DatabaseService.getEvents(user!.id, dateStr, dateStr);
        const sortedEvents = events.sort((a, b) => {
          if (a.all_day && !b.all_day) return 1;
          if (!a.all_day && b.all_day) return -1;
          if (!a.time || !b.time) return 0;
          return a.time.localeCompare(b.time);
        });
        setDayEvents(sortedEvents);
      }
    } catch (error) {
      console.error('Failed to update event:', error);
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
        const events = await DatabaseService.getEvents(user!.id, dateStr, dateStr);
        const sortedEvents = events.sort((a, b) => {
          if (a.all_day && !b.all_day) return 1;
          if (!a.all_day && b.all_day) return -1;
          if (!a.time || !b.time) return 0;
          return a.time.localeCompare(b.time);
        });
        setDayEvents(sortedEvents);
      }
    } catch (error) {
      console.error('Failed to delete event:', error);
      alert('Failed to delete event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="calendar-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="mode-indicator">
        <span className="mode-icon">{MODE_CONFIG[mode].icon}</span>
        <span className="mode-text">{MODE_CONFIG[mode].name} Mode</span>
      </div>

      <div className="calendar-container">
        <main className="calendar-content">
          <CalendarView
            selectedDate={selectedDate}
            onDateSelect={handleDateSelect}
            onEventClick={handleEventClick}
          />

          <EventInput onEventsExtracted={onEventsExtracted} mode={mode} />
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
                        onClick={() => handleEditEvent(event)}
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
                <button
                  onClick={handleDeleteEvent}
                  className="btn btn-danger"
                  disabled={saving}
                >
                  {saving ? 'Deleting...' : 'Delete'}
                </button>
                <div className="edit-actions-right">
                  <button
                    onClick={() => setEditingEvent(null)}
                    className="btn btn-secondary"
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="btn btn-primary"
                    disabled={saving || !editForm.name || !editForm.date}
                  >
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
