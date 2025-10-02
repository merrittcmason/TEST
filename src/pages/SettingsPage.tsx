import { useState, useEffect } from 'react';
import { HamburgerMenu } from '../components/HamburgerMenu';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import type { Database } from '../lib/supabase';
import './SettingsPage.css';

type Event = Database['public']['Tables']['events']['Row'];

interface SettingsPageProps {
  onNavigate: (page: string) => void;
}

export function SettingsPage({ onNavigate }: SettingsPageProps) {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'tag' | 'label' | 'select'>('tag');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      try {
        const start = new Date();
        start.setFullYear(start.getFullYear() - 1);
        const end = new Date();
        end.setFullYear(end.getFullYear() + 1);
        const events = await DatabaseService.getEvents(
          user.id,
          start.toISOString().split('T')[0],
          end.toISOString().split('T')[0]
        );
        setAllEvents(events);

        const tags = Array.from(new Set(events.map(e => e.tag).filter((tag): tag is string => tag !== null && tag !== '')));
        setAvailableTags(tags);

        const labels = Array.from(new Set(events.map(e => (e as any).label).filter((label): label is string => label !== null && label !== '')));
        setAvailableLabels(labels);
      } catch (error) {
        console.error('Failed to load events:', error);
      }
    };

    loadData();
  }, [user]);

  const handleDeleteByTag = async () => {
    if (!selectedTag) return;
    if (!confirm(`Are you sure you want to delete all events with tag "${selectedTag}"?`)) return;

    setDeleting(true);
    try {
      const eventsToDelete = allEvents.filter(e => e.tag === selectedTag);
      for (const event of eventsToDelete) {
        await DatabaseService.deleteEvent(event.id);
      }
      setShowDeleteModal(false);
      setSelectedTag('');
      window.location.reload();
    } catch (error) {
      console.error('Failed to delete events:', error);
      alert('Failed to delete events');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteByLabel = async () => {
    if (!selectedLabel) return;
    if (!confirm(`Are you sure you want to delete all events with label "${selectedLabel}"?`)) return;

    setDeleting(true);
    try {
      const eventsToDelete = allEvents.filter(e => (e as any).label === selectedLabel);
      for (const event of eventsToDelete) {
        await DatabaseService.deleteEvent(event.id);
      }
      setShowDeleteModal(false);
      setSelectedLabel('');
      window.location.reload();
    } catch (error) {
      console.error('Failed to delete events:', error);
      alert('Failed to delete events');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedEvents.length === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedEvents.length} selected event(s)?`)) return;

    setDeleting(true);
    try {
      for (const eventId of selectedEvents) {
        await DatabaseService.deleteEvent(eventId);
      }
      setShowDeleteModal(false);
      setSelectedEvents([]);
      window.location.reload();
    } catch (error) {
      console.error('Failed to delete events:', error);
      alert('Failed to delete events');
    } finally {
      setDeleting(false);
    }
  };

  const toggleEventSelection = (eventId: string) => {
    setSelectedEvents(prev =>
      prev.includes(eventId)
        ? prev.filter(id => id !== eventId)
        : [...prev, eventId]
    );
  };

  return (
    <div className="settings-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="settings-container">
        <main className="settings-content">
          <section className="settings-section">
            <h2 className="section-title">Appearance</h2>
            <div className="settings-card">
              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Theme</label>
                  <p className="setting-description">
                    Choose how Calendar Pilot looks
                  </p>
                </div>
                <div className="theme-selector">
                  <button
                    className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                    onClick={() => setTheme('light')}
                  >
                    Light
                  </button>
                  <button
                    className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                    onClick={() => setTheme('dark')}
                  >
                    Dark
                  </button>
                  <button
                    className={`theme-option ${theme === 'system' ? 'active' : ''}`}
                    onClick={() => setTheme('system')}
                  >
                    System
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="section-title">Notifications</h2>
            <div className="settings-card">
              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Event Reminders</label>
                  <p className="setting-description">
                    Get notified before events start
                  </p>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Daily Summary</label>
                  <p className="setting-description">
                    Receive a summary of today's events each morning
                  </p>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="section-title">Calendar</h2>
            <div className="settings-card">
              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Default View</label>
                  <p className="setting-description">
                    Choose your preferred calendar view
                  </p>
                </div>
                <select className="setting-select">
                  <option value="month">Month</option>
                  <option value="week">Week</option>
                </select>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Week starts on</label>
                  <p className="setting-description">
                    First day of the week
                  </p>
                </div>
                <select className="setting-select">
                  <option value="sunday">Sunday</option>
                  <option value="monday">Monday</option>
                </select>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="section-title">Event Management</h2>
            <div className="settings-card">
              <div className="setting-item">
                <div className="setting-info">
                  <label className="setting-label">Delete Events</label>
                  <p className="setting-description">
                    Bulk delete events by tag, label, or selection
                  </p>
                </div>
                <button
                  className="btn btn-danger"
                  onClick={() => setShowDeleteModal(true)}
                >
                  Manage Deletions
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>

      {showDeleteModal && (
        <div className="delete-modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-modal-header">
              <h3>Delete Events</h3>
              <button className="modal-close" onClick={() => setShowDeleteModal(false)}>✕</button>
            </div>

            <div className="delete-modal-content">
              <div className="delete-mode-tabs">
                <button
                  className={`delete-tab ${deleteMode === 'tag' ? 'active' : ''}`}
                  onClick={() => setDeleteMode('tag')}
                >
                  By Tag
                </button>
                <button
                  className={`delete-tab ${deleteMode === 'label' ? 'active' : ''}`}
                  onClick={() => setDeleteMode('label')}
                >
                  By Label
                </button>
                <button
                  className={`delete-tab ${deleteMode === 'select' ? 'active' : ''}`}
                  onClick={() => setDeleteMode('select')}
                >
                  Select Events
                </button>
              </div>

              {deleteMode === 'tag' && (
                <div className="delete-option-content">
                  {availableTags.length === 0 ? (
                    <p className="no-data-message">No tags found</p>
                  ) : (
                    <>
                      <select
                        className="delete-select"
                        value={selectedTag}
                        onChange={(e) => setSelectedTag(e.target.value)}
                      >
                        <option value="">Select a tag</option>
                        {availableTags.map(tag => (
                          <option key={tag} value={tag}>{tag}</option>
                        ))}
                      </select>
                      <button
                        className="btn btn-danger"
                        onClick={handleDeleteByTag}
                        disabled={!selectedTag || deleting}
                      >
                        {deleting ? 'Deleting...' : 'Delete All with This Tag'}
                      </button>
                    </>
                  )}
                </div>
              )}

              {deleteMode === 'label' && (
                <div className="delete-option-content">
                  {availableLabels.length === 0 ? (
                    <p className="no-data-message">No labels found</p>
                  ) : (
                    <>
                      <select
                        className="delete-select"
                        value={selectedLabel}
                        onChange={(e) => setSelectedLabel(e.target.value)}
                      >
                        <option value="">Select a label</option>
                        {availableLabels.map(label => (
                          <option key={label} value={label}>{label}</option>
                        ))}
                      </select>
                      <button
                        className="btn btn-danger"
                        onClick={handleDeleteByLabel}
                        disabled={!selectedLabel || deleting}
                      >
                        {deleting ? 'Deleting...' : 'Delete All with This Label'}
                      </button>
                    </>
                  )}
                </div>
              )}

              {deleteMode === 'select' && (
                <div className="delete-option-content">
                  {allEvents.length === 0 ? (
                    <p className="no-data-message">No events found</p>
                  ) : (
                    <>
                      <div className="events-selection-list">
                        {allEvents.map(event => (
                          <label key={event.id} className="event-checkbox-label">
                            <input
                              type="checkbox"
                              checked={selectedEvents.includes(event.id)}
                              onChange={() => toggleEventSelection(event.id)}
                            />
                            <div className="event-checkbox-info">
                              <div className="event-checkbox-name">{event.name}</div>
                              <div className="event-checkbox-meta">
                                {event.date} {event.time && `at ${event.time}`}
                                {event.tag && <span className="event-meta-tag">{event.tag}</span>}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                      <button
                        className="btn btn-danger"
                        onClick={handleDeleteSelected}
                        disabled={selectedEvents.length === 0 || deleting}
                      >
                        {deleting ? 'Deleting...' : `Delete ${selectedEvents.length} Selected Event(s)`}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
