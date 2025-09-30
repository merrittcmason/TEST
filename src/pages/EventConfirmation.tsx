import { useState } from 'react';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import type { ParsedEvent } from '../services/openai';
import './EventConfirmation.css';

interface EventConfirmationProps {
  events: ParsedEvent[];
  onConfirm: () => void;
  onCancel: () => void;
}

interface EditableEvent extends ParsedEvent {
  tempId: string;
}

export function EventConfirmation({ events, onConfirm, onCancel }: EventConfirmationProps) {
  const { user } = useAuth();
  const [editableEvents, setEditableEvents] = useState<EditableEvent[]>(
    events.map((e, i) => ({ ...e, tempId: `temp-${i}` }))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFieldChange = (tempId: string, field: keyof ParsedEvent, value: string | null) => {
    setEditableEvents(prev =>
      prev.map(e => (e.tempId === tempId ? { ...e, [field]: value } : e))
    );
  };

  const handleAddEvent = () => {
    const newEvent: EditableEvent = {
      tempId: `temp-${Date.now()}`,
      event_name: '',
      event_date: new Date().toISOString().split('T')[0],
      event_time: null,
      event_tag: null,
    };
    setEditableEvents(prev => [...prev, newEvent]);
  };

  const handleRemoveEvent = (tempId: string) => {
    setEditableEvents(prev => prev.filter(e => e.tempId !== tempId));
  };

  const validateEvents = () => {
    for (const event of editableEvents) {
      if (!event.event_name.trim()) {
        throw new Error('All events must have a name');
      }
      if (!event.event_date) {
        throw new Error('All events must have a date');
      }
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

      const eventsToCreate = editableEvents.map(e => ({
        user_id: user.id,
        name: e.event_name,
        date: e.event_date,
        time: e.event_time,
        all_day: !e.event_time,
        tag: e.event_tag,
      }));

      await DatabaseService.createEvents(eventsToCreate);
      onConfirm();
    } catch (err: any) {
      setError(err.message || 'Failed to save events');
    } finally {
      setLoading(false);
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
                    onChange={(e) =>
                      handleFieldChange(event.tempId, 'event_time', e.target.value || null)
                    }
                  />
                </div>

                <div className="field-group">
                  <label>Tag (optional)</label>
                  <input
                    type="text"
                    value={event.event_tag || ''}
                    onChange={(e) =>
                      handleFieldChange(event.tempId, 'event_tag', e.target.value || null)
                    }
                    placeholder="e.g., work, personal"
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

        <button onClick={handleAddEvent} className="btn btn-secondary add-event-btn" disabled={loading}>
          + Add Another Event
        </button>

        {error && <div className="confirmation-error">{error}</div>}

        <div className="confirmation-actions">
          <button onClick={onCancel} className="btn btn-secondary" disabled={loading}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="btn btn-primary"
            disabled={loading || editableEvents.length === 0}
          >
            {loading ? (
              <>
                <div className="loading-spinner" style={{ width: 20, height: 20 }} />
                Publishing...
              </>
            ) : (
              `Confirm & Publish (${editableEvents.length})`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
