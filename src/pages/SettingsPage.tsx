// src/pages/SettingsPage.tsx
import { useState, useEffect, useMemo } from 'react';
import { HamburgerMenu } from '../components/HamburgerMenu';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import { getDeviceTimezone } from '../utils/timeUtils';
import type { Database } from '../lib/supabase';
import './SettingsPage.css';

type Event = Database['public']['Tables']['events']['Row'];

interface SettingsPageProps {
  onNavigate: (page: string) => void;
}

function detectLocaleTimeFormat(): '12' | '24' {
  try {
    const d = new Date(Date.UTC(2020, 0, 1, 13, 0, 0));
    const s = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: 'numeric' }).format(d);
    if (/\bAM\b|\bPM\b|am|pm/i.test(s)) return '12';
    if (/\b13\b|\b14\b|\b15\b|\b16\b|\b17\b|\b18\b|\b19\b|\b20\b|\b21\b|\b22\b|\b23\b/.test(s)) return '24';
  } catch {}
  return '24';
}

function getTimezones(): string[] {
  const anyIntl: any = Intl as any;
  if (typeof anyIntl.supportedValuesOf === 'function') {
    return anyIntl.supportedValuesOf('timeZone') as string[];
  }
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Kolkata',
    'Australia/Sydney'
  ];
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

  const deviceTz = useMemo(() => getDeviceTimezone(), []);
  const tzList = useMemo(() => getTimezones(), []);
  const localeDefaultFormat = useMemo(() => detectLocaleTimeFormat(), []);
  const [saving, setSaving] = useState(false);

  const [tzMode, setTzMode] = useState<'auto' | 'manual'>('auto');
  const [timezone, setTimezone] = useState<string>(deviceTz);
  const [timeFormat, setTimeFormat] = useState<'auto' | '12' | '24'>('auto');

  const [remindersEnabled, setRemindersEnabled] = useState<boolean>(false);
  const [dailySummaryEnabled, setDailySummaryEnabled] = useState<boolean>(false);
  const [defaultView, setDefaultView] = useState<'month' | 'week'>('month');
  const [weekStartsOn, setWeekStartsOn] = useState<'sunday' | 'monday'>('sunday');

  const [initialPrefs, setInitialPrefs] = useState({
    tzMode: 'auto' as 'auto' | 'manual',
    timezone: deviceTz,
    timeFormat: 'auto' as 'auto' | '12' | '24',
    remindersEnabled: false,
    dailySummaryEnabled: false,
    defaultView: 'month' as 'month' | 'week',
    weekStartsOn: 'sunday' as 'sunday' | 'monday'
  });

  useEffect(() => {
    if (!user) return;
    const init = async () => {
      try {
        const prefs = await DatabaseService.getUserPreferences(user.id);
        const prefTz = prefs?.timezone_preference ?? null;
        const prefFmt = (prefs?.time_format_preference ?? 'auto') as 'auto' | '12' | '24';
        const mode = prefTz && tzList.includes(prefTz) ? 'manual' : 'auto';
        const tz = mode === 'manual' ? prefTz! : deviceTz;
        setTzMode(mode);
        setTimezone(tz);
        setTimeFormat(prefFmt === '12' || prefFmt === '24' ? prefFmt : 'auto');

        const lsRem = localStorage.getItem('settings.remindersEnabled');
        const lsSum = localStorage.getItem('settings.dailySummaryEnabled');
        const lsView = localStorage.getItem('settings.defaultView');
        const lsWeek = localStorage.getItem('settings.weekStartsOn');

        const rem = lsRem ? lsRem === 'true' : false;
        const sum = lsSum ? lsSum === 'true' : false;
        const view = lsView === 'week' ? 'week' : 'month';
        const week = lsWeek === 'monday' ? 'monday' : 'sunday';

        setRemindersEnabled(rem);
        setDailySummaryEnabled(sum);
        setDefaultView(view);
        setWeekStartsOn(week);

        setInitialPrefs({
          tzMode: mode,
          timezone: tz,
          timeFormat: prefFmt === '12' || prefFmt === '24' ? prefFmt : 'auto',
          remindersEnabled: rem,
          dailySummaryEnabled: sum,
          defaultView: view,
          weekStartsOn: week
        });
      } catch (e: any) {
        console.error(e?.message || e);
      }
    };
    init();
  }, [user, deviceTz, tzList]);

  useEffect(() => {
    if (!user) return;
    const loadData = async () => {
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
    };
    loadData();
  }, [user]);

  const isDirty = useMemo(() => {
    return (
      tzMode !== initialPrefs.tzMode ||
      timezone !== initialPrefs.timezone ||
      timeFormat !== initialPrefs.timeFormat ||
      remindersEnabled !== initialPrefs.remindersEnabled ||
      dailySummaryEnabled !== initialPrefs.dailySummaryEnabled ||
      defaultView !== initialPrefs.defaultView ||
      weekStartsOn !== initialPrefs.weekStartsOn
    );
  }, [
    tzMode,
    timezone,
    timeFormat,
    remindersEnabled,
    dailySummaryEnabled,
    defaultView,
    weekStartsOn,
    initialPrefs
  ]);

  const handleSaveAll = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await DatabaseService.updateUserPreferences(user.id, {
        timezone_preference: tzMode === 'manual' ? timezone : null,
        time_format_preference: timeFormat
      });
      localStorage.setItem('settings.remindersEnabled', String(remindersEnabled));
      localStorage.setItem('settings.dailySummaryEnabled', String(dailySummaryEnabled));
      localStorage.setItem('settings.defaultView', defaultView);
      localStorage.setItem('settings.weekStartsOn', weekStartsOn);
      setInitialPrefs({
        tzMode,
        timezone,
        timeFormat,
        remindersEnabled,
        dailySummaryEnabled,
        defaultView,
        weekStartsOn
      });
    } catch (e: any) {
      console.error(e?.message || e);
      alert(e?.message || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

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
    } finally {
      setDeleting(false);
    }
  };

  const toggleEventSelection = (eventId: string) => {
    setSelectedEvents(prev => (prev.includes(eventId) ? prev.filter(id => id !== eventId) : [...prev, eventId]));
  };

  return (
    <div className="settings-page">
      <HamburgerMenu onNavigate={onNavigate} />
      <div className="settings-container">
        <main className="settings-content">
          <section className="settings-section">
            <h2 className="section-title">Date & Time</h2>
            <div className="settings-card">
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-label">Timezone</div>
                  <div className="setting-description">Choose how times are displayed</div>
                </div>
                <div className="setting-inline">
                  <select
                    className="setting-select"
                    value={tzMode === 'auto' ? 'auto' : timezone}
                    onChange={e => {
                      const val = e.target.value;
                      if (val === 'auto') {
                        setTzMode('auto');
                        setTimezone(deviceTz);
                      } else {
                        setTzMode('manual');
                        setTimezone(val);
                      }
                    }}
                  >
                    <option value="auto">Automatic ({deviceTz})</option>
                    {tzList.map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-label">Time Format</div>
                  <div className="setting-description">12-hour or 24-hour clock</div>
                </div>
                <div className="setting-inline">
                  <select
                    className="setting-select"
                    value={timeFormat}
                    onChange={e => setTimeFormat(e.target.value as 'auto' | '12' | '24')}
                  >
                    <option value="auto">Automatic ({localeDefaultFormat === '24' ? '24-hour' : '12-hour'})</option>
                    <option value="12">12-hour</option>
                    <option value="24">24-hour</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="section-title">Appearance</h2>
            <div className="settings-card">
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-label">Theme</div>
                  <div className="setting-description">Choose how Calendar Pilot looks</div>
                </div>
                <div className="theme-selector">
                  <button className={`theme-option ${theme === 'light' ? 'active' : ''}`} onClick={() => setTheme('light')}>Light</button>
                  <button className={`theme-option ${theme === 'dark' ? 'active' : ''}`} onClick={() => setTheme('dark')}>Dark</button>
                  <button className={`theme-option ${theme === 'system' ? 'active' : ''}`} onClick={() => setTheme('system')}>System</button>
                </div>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h2 className="section-title">Notifications</h2>
            <div className="settings-card">
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-label">Event Reminders</div>
                  <div className="setting-description">Get notified before events start</div>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={remindersEnabled} onChange={e => setRemindersEnabled(e.target.checked)} />
                  <span className="toggle-slider"></span>
                </label>
              </div>
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-label">Daily Summary</div>
                  <div className="setting-description">Receive a summary of today's events each morning</div>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={dailySummaryEnabled} onChange={e => setDailySummaryEnabled(e.target.checked)} />
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
                  <div className="setting-label">Default View</div>
                  <div className="setting-description">Choose your preferred calendar view</div>
                </div>
                <select className="setting-select" value={defaultView} onChange={e => setDefaultView(e.target.value as 'month' | 'week')}>
                  <option value="month">Month</option>
                  <option value="week">Week</option>
                </select>
              </div>
              <div className="setting-item">
                <div className="setting-info">
                  <div className="setting-label">Week starts on</div>
                  <div className="setting-description">First day of the week</div>
                </div>
                <select className="setting-select" value={weekStartsOn} onChange={e => setWeekStartsOn(e.target.value as 'sunday' | 'monday')}>
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
                  <div className="setting-label">Delete Events</div>
                  <div className="setting-description">Bulk delete events by tag, label, or selection</div>
                </div>
                <button className="btn btn-danger" onClick={() => setShowDeleteModal(true)}>Manage Deletions</button>
              </div>
            </div>
          </section>
        </main>
      </div>

      {showDeleteModal && (
        <div className="delete-modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="delete-modal" onClick={e => e.stopPropagation()}>
            <div className="delete-modal-header">
              <h3>Delete Events</h3>
              <button className="modal-close" onClick={() => setShowDeleteModal(false)}>✕</button>
            </div>
            <div className="delete-modal-content">
              <div className="delete-mode-tabs">
                <button className={`delete-tab ${deleteMode === 'tag' ? 'active' : ''}`} onClick={() => setDeleteMode('tag')}>By Tag</button>
                <button className={`delete-tab ${deleteMode === 'label' ? 'active' : ''}`} onClick={() => setDeleteMode('label')}>By Label</button>
                <button className={`delete-tab ${deleteMode === 'select' ? 'active' : ''}`} onClick={() => setDeleteMode('select')}>Select Events</button>
              </div>
              {deleteMode === 'tag' && (
                <div className="delete-option-content">
                  {availableTags.length === 0 ? (
                    <p className="no-data-message">No tags found</p>
                  ) : (
                    <>
                      <select className="delete-select" value={selectedTag} onChange={e => setSelectedTag(e.target.value)}>
                        <option value="">Select a tag</option>
                        {availableTags.map(tag => (<option key={tag} value={tag}>{tag}</option>))}
                      </select>
                      <button className="btn btn-danger" onClick={handleDeleteByTag} disabled={!selectedTag || deleting}>
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
                      <select className="delete-select" value={selectedLabel} onChange={e => setSelectedLabel(e.target.value)}>
                        <option value="">Select a label</option>
                        {availableLabels.map(label => (<option key={label} value={label}>{label}</option>))}
                      </select>
                      <button className="btn btn-danger" onClick={handleDeleteByLabel} disabled={!selectedLabel || deleting}>
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
                            <input type="checkbox" checked={selectedEvents.includes(event.id)} onChange={() => toggleEventSelection(event.id)} />
                            <div className="event-checkbox-info">
                              <div className="event-checkbox-name">{(event as any).name ?? event.title}</div>
                              <div className="event-checkbox-meta">
                                {(event as any).date ?? event.start_date}{' '}
                                {(event as any).time ?? event.start_time ? <>at {(event as any).time ?? event.start_time} </> : null}
                                {event.tag && <span className="event-meta-tag">{event.tag}</span>}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                      <button className="btn btn-danger" onClick={handleDeleteSelected} disabled={selectedEvents.length === 0 || deleting}>
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

      {isDirty && (
<button
  className={`save-changes-pill ${isDirty ? 'show' : ''}`}
  onClick={handleSaveAll}
  disabled={saving || !isDirty}
>
  {saving ? 'Saving…' : 'Save Changes'}
</button>

      )}
    </div>
  );
}
