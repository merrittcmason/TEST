import { useState, useEffect } from 'react';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { useMode, MODE_CONFIG } from '../contexts/ModeContext';
import './EventConfirmation.css';

interface EventConfirmationProps {
  events: any[];
  onConfirm: () => void;
  onCancel: () => void;
}

interface EditableEvent {
  tempId: string;
  title: string;
  all_day: boolean;
  is_recurring: boolean;
  recurrence_rule: string | null;
  tag: string | null;
  label: string | null;
  start_at: string | null;
  end_at: string | null;
  location: string | null;
  description: string | null;
}

function toUTC(dateTime: string) {
  if (!dateTime) return null;
  const local = new Date(dateTime);
  const utc = new Date(local.toLocaleString('en-US', { timeZone: 'UTC' }));
  return utc.toISOString();
}

export function EventConfirmation({ events, onConfirm, onCancel }: EventConfirmationProps) {
  const { user } = useAuth();
  const { mode } = useMode();
  const [editableEvents, setEditableEvents] = useState<EditableEvent[]>(
    events.map((e, i) => ({
      tempId: `temp-${i}`,
      title: e.title || '',
      all_day: e.all_day || false,
      is_recurring: e.is_recurring || false,
      recurrence_rule: e.recurrence_rule || null,
      tag: e.tag || null,
      label: e.label || null,
      start_at: e.start_at || '',
      end_at: e.end_at || '',
      location: e.location || null,
      description: e.description || null
    }))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [applyLabelToAll, setApplyLabelToAll] = useState(false);
  const [globalLabel, setGlobalLabel] = useState('');

  useEffect(() => {
    if (applyLabelToAll && globalLabel) {
      setEditableEvents(prev => prev.map(e => ({ ...e, label: globalLabel })));
    }
  }, [applyLabelToAll, globalLabel]);

  const handleFieldChange = (tempId: string, field: keyof EditableEvent, value: any) => {
    setEditableEvents(prev =>
      prev.map(e => (e.tempId === tempId ? { ...e, [field]: value } : e))
    );
    if (field === 'label' && applyLabelToAll) {
      setGlobalLabel(value || '');
    }
  };

  const handleAddEvent = () => {
    const newEvent: EditableEvent = {
      tempId: `temp-${Date.now()}`,
      title: '',
      all_day: false,
      is_recurring: false,
      recurrence_rule: null,
      tag: null,
      label: applyLabelToAll ? globalLabel : null,
      start_at: new Date().toISOString().split('T')[0] + 'T09:00',
      end_at: new Date().toISOString().split('T')[0] + 'T10:00',
      location: null,
      description: null
    };
    setEditableEvents(prev => [...prev, newEvent]);
  };

  const handleRemoveEvent = (tempId: string) => {
    setEditableEvents(prev => prev.filter(e => e.tempId !== tempId));
  };

  const validateEvents = () => {
    for (const event of editableEvents) {
      if (!event.title.trim()) throw new Error('All events must have a title');
      if (!event.all_day && (!event.start_at || !event.end_at)) throw new Error('All timed events must have start and end times');
    }
  };

  const handleConfirm = async () => {
    if (!user) {
      setError('Not authenticated');
      return;
    }
    setError('');
    setLoading(true);
    try {
      validateEvents();
      const rows = editableEvents.map(e => ({
        user_id: user.id,
        title: e.title,
        all_day: e.all_day,
        is_recurring: e.is_recurring,
        recurrence_rule: e.is_recurring ? e.recurrence_rule : null,
        tag: e.tag,
        label: e.label,
        start_at: e.all_day ? null : toUTC(e.start_at!),
        end_at: e.all_day ? null : toUTC(e.end_at!),
        tzid: 'UTC',
        location: e.location,
        description: e.description
      }));
      await DatabaseService.createEvents(rows);
      await DatabaseService.clearDraftEvents(user.id);
      onConfirm();
    } catch (err: any) {
      setError(err.message || 'Failed to save events');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveForLater = async () => {
    if (!user) {
      setError('Not authenticated');
      return;
    }
    setError('');
    setLoading(true);
    try {
      validateEvents();
      const drafts = editableEvents.map(e => ({
        user_id: user.id,
        title: e.title,
        all_day: e.all_day,
        is_recurring: e.is_recurring,
        recurrence_rule: e.is_recurring ? e.recurrence_rule : null,
        tag: e.tag,
        label: e.label,
        start_at: e.all_day ? null : toUTC(e.start_at!),
        end_at: e.all_day ? null : toUTC(e.end_at!),
        tzid: 'UTC',
        location: e.location,
        description: e.description
      }));
      await DatabaseService.replaceDraftEvents(user.id, drafts);
      onConfirm();
    } catch (err: any) {
      setError(err.message || 'Failed to save drafts');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelDiscard = async () => {
    if (!user) {
      onCancel();
      return;
    }
    setLoading(true);
    try {
      await DatabaseService.clearDraftEvents(user.id);
    } finally {
      setLoading(false);
      onCancel();
    }
  };

  return (
    <div className="event-confirmation-page">
      <div className="confirmation-container">
        <header className="confirmation-header">
          <h1>Confirm Events</h1>
          <p>Review and edit the extracted events before publishing</p>
        </header>
        <div className="events-list">
          {editableEvents.map(event => (
            <div key={event.tempId} className="event-row">
              <div className="event-fields">
                <div className="field-group">
                  <label>Title</label>
                  <input
                    type="text"
                    value={event.title}
                    onChange={(e) => handleFieldChange(event.tempId, 'title', e.target.value)}
                    placeholder="Enter event title"
                  />
                </div>
                <div className="field-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={event.all_day}
                      onChange={(e) => {
                        handleFieldChange(event.tempId, 'all_day', e.target.checked);
                        if (e.target.checked) {
                          handleFieldChange(event.tempId, 'start_at', null);
                          handleFieldChange(event.tempId, 'end_at', null);
                        } else {
                          const today = new Date().toISOString().split('T')[0];
                          handleFieldChange(event.tempId, 'start_at', `${today}T09:00`);
                          handleFieldChange(event.tempId, 'end_at', `${today}T10:00`);
                        }
                      }}
                    />
                    All Day
                  </label>
                </div>
                <div className="field-group checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={event.is_recurring}
                      onChange={(e) => {
                        handleFieldChange(event.tempId, 'is_recurring', e.target.checked);
                        if (!e.target.checked) handleFieldChange(event.tempId, 'recurrence_rule', null);
                      }}
                    />
                    Recurring Event
                  </label>
                </div>
                {event.is_recurring && (
                  <div className="field-group">
                    <label>Repeat</label>
                    <select
                      value={event.recurrence_rule || ''}
                      onChange={(e) => handleFieldChange(event.tempId, 'recurrence_rule', e.target.value)}
                    >
                      <option value="">Select frequency</option>
                      <option value="FREQ=DAILY">Daily</option>
                      <option value="FREQ=WEEKLY">Weekly</option>
                      <option value="FREQ=MONTHLY">Monthly</option>
                      <option value="FREQ=YEARLY">Yearly</option>
                    </select>
                  </div>
                )}
                {!event.all_day && (
                  <>
                    <div className="field-group">
                      <label>Starts At</label>
                      <input
                        type="datetime-local"
                        value={event.start_at || ''}
                        onChange={(e) => handleFieldChange(event.tempId, 'start_at', e.target.value)}
                      />
                    </div>
                    <div className="field-group">
                      <label>Ends At</label>
                      <input
                        type="datetime-local"
                        value={event.end_at || ''}
                        onChange={(e) => handleFieldChange(event.tempId, 'end_at', e.target.value)}
                      />
                    </div>
                  </>
                )}
                <div className="field-group">
                  <label>Location</label>
                  <input
                    type="text"
                    value={event.location || ''}
                    onChange={(e) => handleFieldChange(event.tempId, 'location', e.target.value || null)}
                    placeholder="e.g., Online or LY 324"
                  />
                </div>
                <div className="field-group">
                  <label>Tag</label>
                  <input
                    type="text"
                    value={event.tag || ''}
                    onChange={(e) => handleFieldChange(event.tempId, 'tag', e.target.value || null)}
                    placeholder="e.g., Class, Meeting"
                  />
                </div>
                <div className="field-group">
                  <label>Label</label>
                  <input
                    type="text"
                    value={event.label || ''}
                    onChange={(e) => handleFieldChange(event.tempId, 'label', e.target.value || null)}
                    placeholder="e.g., CS101, BIO-200"
                  />
                </div>
                <div className="field-group">
                  <label>Description</label>
                  <textarea
                    value={event.description || ''}
                    onChange={(e) => handleFieldChange(event.tempId, 'description', e.target.value || null)}
                    placeholder="Enter details"
                  />
                </div>
              </div>
              <button
                onClick={() => handleRemoveEvent(event.tempId)}
                className="btn btn-danger remove-btn"
                disabled={loading}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="label-options">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={applyLabelToAll}
              onChange={(e) => {
                setApplyLabelToAll(e.target.checked);
                if (e.target.checked && editableEvents[0]?.label) {
                  setGlobalLabel(editableEvents[0].label);
                }
              }}
            />
            <span>Apply Label to All Events</span>
          </label>
        </div>
        <button onClick={handleAddEvent} className="btn btn-secondary add-event-btn" disabled={loading}>
          + Add Another Event
        </button>
        {error && <div className="confirmation-error">{error}</div>}
        <div className="confirmation-actions">
          <button onClick={handleCancelDiscard} className="btn btn-secondary" disabled={loading}>
            Cancel
          </button>
          <button onClick={handleSaveForLater} className="btn btn-secondary" disabled={loading}>
            Save for Later
          </button>
          <button
            onClick={handleConfirm}
            className="btn btn-primary"
            disabled={loading || editableEvents.length === 0}
          >
            {loading ? 'Publishing...' : `Confirm & Publish (${editableEvents.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
