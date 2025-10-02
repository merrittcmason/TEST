import { useState, useEffect } from 'react';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { useMode, MODE_CONFIG } from '../contexts/ModeContext';
import type { ParsedEvent } from '../services/openai';
import './EventConfirmation.css';

interface EventConfirmationProps {
  events: ParsedEvent[];
  onConfirm: () => void;
  onCancel: () => void;
}

interface EditableEvent extends ParsedEvent {
  tempId: string;
  event_label?: string | null;
}

function dedupeEditable(list: EditableEvent[]) {
  const seen = new Set<string>();
  const out: EditableEvent[] = [];
  for (const e of list) {
    const k = `${(e.event_name||'').trim().toLowerCase()}|${e.event_date}|${e.event_time||''}|${e.event_tag||''}|${e.event_label||''}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e);
    }
  }
  return out;
}

export function EventConfirmation({ events, onConfirm, onCancel }: EventConfirmationProps) {
  const { user } = useAuth();
  const { mode } = useMode();
  const [editableEvents, setEditableEvents] = useState<EditableEvent[]>(
    events.map((e, i) => ({ ...e, tempId: `temp-${i}`, event_label: null }))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [applyLabelToAll, setApplyLabelToAll] = useState(false);
  const [globalLabel, setGlobalLabel] = useState('');

  useEffect(() => {
    if (applyLabelToAll && globalLabel) {
      setEditableEvents(prev => prev.map(e => ({ ...e, event_label: globalLabel })));
    }
  }, [applyLabelToAll, globalLabel]);

  const handleFieldChange = (tempId: string, field: keyof EditableEvent, value: string | null) => {
    setEditableEvents(prev =>
      prev.map(e => (e.tempId === tempId ? { ...e, [field]: value } : e))
    );
    if (field === 'event_label' && applyLabelToAll) {
      setGlobalLabel(value || '');
    }
  };

  const handleAddEvent = () => {
    const defaultTime = mode === 'education' ? MODE_CONFIG.education.defaultTime : null;
    const newEvent: EditableEvent = {
      tempId: `temp-${Date.now()}`,
      event_name: '',
      event_date: new Date().toISOString().split('T')[0],
      event_time: defaultTime,
      event_tag: null,
      event_label: applyLabelToAll ? globalLabel : null,
    };
    setEditableEvents(prev => [...prev, newEvent]);
  };

  const handleRemoveEvent = (tempId: string) => {
    setEditableEvents(prev => prev.filter(e => e.tempId !== tempId));
  };

  const validateEvents = () => {
    for (const event of editableEvents) {
      if (!event.event_name.trim()) throw new Error('All events must have a name');
      if (!event.event_date) throw new Error('All events must have a date');
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
      const clean = dedupeEditable(editableEvents);
      const rows = clean.map(e => ({
        user_id: user.id,
        name: e.event_name,
        date: e.event_date,
        time: e.event_time,
        all_day: !e.event_time,
        tag: e.event_tag,
        label: e.event_label ?? null,
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
      const clean = dedupeEditable(editableEvents);
      const drafts = clean.map(e => ({
        user_id: user.id,
        event_name: e.event_name,
        event_date: e.event_date,
        event_time: e.event_time,
        event_tag: e.event_tag,
        label: e.event_label ?? null,
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
                  <label>Event Name</label>
                  <input
                    type="text"
                    value={event.event_name}
                    onChange={(e) => handleFieldChange(event.tempId, 'event_name', e.target.value)}
                    placeholder="Enter event name"
                  />
                </div>
                <div className="field-group">
                  <label>Date</label>
                  <input
                    type="date"
                    value={event.event_date}
                    onChange={(e) => handleFieldChange(event.tempId, 'event_date', e.target.value)}
                  />
                </div>
                <div className="field-group">
                  <label>Time (optional)</label>
                  <input
                    type="time"
                    value={event.event_time || ''}
                    onChange={(e) => handleFieldChange(event.tempId, 'event_time', e.target.value || null)}
                  />
                </div>
                <div className="field-group">
                  <label>Tags (optional)</label>
                  <input
                    type="text"
                    value={event.event_tag || ''}
                    onChange={(e) => handleFieldChange(event.tempId, 'event_tag', e.target.value || null)}
                    placeholder="e.g., homework, quiz"
                  />
                </div>
                <div className="field-group">
                  <label>Label (optional)</label>
                  <input
                    type="text"
                    value={event.event_label || ''}
                    onChange={(e) => handleFieldChange(event.tempId, 'event_label', e.target.value || null)}
                    placeholder="e.g., CS101, BIO-200"
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
                if (e.target.checked && editableEvents[0]?.event_label) {
                  setGlobalLabel(editableEvents[0].event_label);
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
