import { useState, useEffect } from 'react'
import { DatabaseService } from '../services/database'
import { useAuth } from '../contexts/AuthContext'
import { useMode } from '../contexts/ModeContext'
import './EventConfirmation.css'

interface EventConfirmationProps {
  events: any[]
  onConfirm: () => void
  onCancel: () => void
}

interface EditableEvent {
  tempId: string
  title: string
  location: string | null
  all_day: boolean
  start_date: string | null
  start_time: string | null
  end_date: string | null
  end_time: string | null
  is_recurring: boolean
  recurrence_rule: string | null
  label: string | null
  tag: string | null
  description: string | null
}

export function EventConfirmation({ events, onConfirm, onCancel }: EventConfirmationProps) {
  const { user } = useAuth()
  const { mode } = useMode()
  const [editableEvents, setEditableEvents] = useState<EditableEvent[]>(
    events.map((e, i) => ({
      tempId: `temp-${i}`,
      title: e.title || '',
      location: e.location || '',
      all_day: e.all_day || false,
      start_date: e.start_date || new Date().toISOString().split('T')[0],
      start_time: e.start_time || '09:00',
      end_date: e.end_date || new Date().toISOString().split('T')[0],
      end_time: e.end_time || '10:00',
      is_recurring: e.is_recurring || false,
      recurrence_rule: e.recurrence_rule || '',
      label: e.label || '',
      tag: e.tag || '',
      description: e.description || ''
    }))
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [applyLabelToAll, setApplyLabelToAll] = useState(false)
  const [globalLabel, setGlobalLabel] = useState('')

  useEffect(() => {
    if (applyLabelToAll && globalLabel) {
      setEditableEvents(prev => prev.map(e => ({ ...e, label: globalLabel })))
    }
  }, [applyLabelToAll, globalLabel])

  const handleFieldChange = (tempId: string, field: keyof EditableEvent, value: any) => {
    setEditableEvents(prev =>
      prev.map(e => (e.tempId === tempId ? { ...e, [field]: value } : e))
    )
    if (field === 'label' && applyLabelToAll) {
      setGlobalLabel(value || '')
    }
  }

  const handleAddEvent = () => {
    const today = new Date().toISOString().split('T')[0]
    const newEvent: EditableEvent = {
      tempId: `temp-${Date.now()}`,
      title: '',
      location: '',
      all_day: false,
      start_date: today,
      start_time: '09:00',
      end_date: today,
      end_time: '10:00',
      is_recurring: false,
      recurrence_rule: '',
      label: '',
      tag: '',
      description: ''
    }
    setEditableEvents(prev => [...prev, newEvent])
  }

  const handleRemoveEvent = (tempId: string) => {
    setEditableEvents(prev => prev.filter(e => e.tempId !== tempId))
  }

  const validateEvents = () => {
    for (const e of editableEvents) {
      if (!e.title.trim()) throw new Error('Each event must have a title')
      if (!e.start_date || !e.end_date) throw new Error('Each event must have start and end dates')
    }
  }

  const handleConfirm = async () => {
    if (!user) return setError('Not authenticated')
    setError('')
    setLoading(true)
    try {
      validateEvents()
      const rows = editableEvents.map(e => ({
        user_id: user.id,
        title: e.title,
        all_day: e.all_day,
        is_recurring: e.is_recurring,
        recurrence_rule: e.is_recurring ? e.recurrence_rule : null,
        start_date: e.start_date,
        start_time: e.all_day ? null : e.start_time,
        end_date: e.end_date,
        end_time: e.all_day ? null : e.end_time,
        tzid: 'UTC',
        location: e.location,
        description: e.description,
        tag: e.tag,
        label: e.label
      }))
      await DatabaseService.createEvents(rows)
      await DatabaseService.clearDraftEvents(user.id)
      onConfirm()
    } catch (err: any) {
      setError(err.message || 'Failed to save events')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveForLater = async () => {
    if (!user) return setError('Not authenticated')
    setError('')
    setLoading(true)
    try {
      validateEvents()
      const drafts = editableEvents.map(e => ({
        user_id: user.id,
        title: e.title,
        all_day: e.all_day,
        is_recurring: e.is_recurring,
        recurrence_rule: e.is_recurring ? e.recurrence_rule : null,
        start_date: e.start_date,
        start_time: e.all_day ? null : e.start_time,
        end_date: e.end_date,
        end_time: e.all_day ? null : e.end_time,
        tzid: 'UTC',
        location: e.location,
        description: e.description,
        tag: e.tag,
        label: e.label
      }))
      await DatabaseService.replaceDraftEvents(user.id, drafts)
      onConfirm()
    } catch (err: any) {
      setError(err.message || 'Failed to save drafts')
    } finally {
      setLoading(false)
    }
  }

  const handleCancelDiscard = async () => {
    if (!user) return onCancel()
    setLoading(true)
    try {
      await DatabaseService.clearDraftEvents(user.id)
    } finally {
      setLoading(false)
      onCancel()
    }
  }

  return (
    <div className="event-confirmation-page">
      <div className="confirmation-container">
        <header className="confirmation-header">
          <h1>Confirm Events</h1>
          <p>Review and edit the extracted events before publishing</p>
        </header>

        <div className="events-list">
          {editableEvents.map(event => (
            <div key={event.tempId} className="event-card">
              <div className="field-group full">
                <label>Title</label>
                <input
                  type="text"
                  value={event.title}
                  onChange={e => handleFieldChange(event.tempId, 'title', e.target.value)}
                  placeholder="Enter event title"
                />
              </div>

              <div className="field-group full">
                <label>Location</label>
                <input
                  type="text"
                  value={event.location || ''}
                  onChange={e => handleFieldChange(event.tempId, 'location', e.target.value)}
                  placeholder="e.g., Online or LY 324"
                />
              </div>

              <div className="slider-group">
                <label>All Day</label>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={event.all_day}
                    onChange={e => handleFieldChange(event.tempId, 'all_day', e.target.checked)}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="field-group full">
                <label>Starts At</label>
                <div className="split-fields">
                  <input
                    type="date"
                    value={event.start_date || ''}
                    onChange={e => handleFieldChange(event.tempId, 'start_date', e.target.value)}
                  />
                  {!event.all_day && (
                    <input
                      type="time"
                      value={event.start_time || ''}
                      onChange={e => handleFieldChange(event.tempId, 'start_time', e.target.value)}
                    />
                  )}
                </div>
              </div>

              <div className="field-group full">
                <label>Ends At</label>
                <div className="split-fields">
                  <input
                    type="date"
                    value={event.end_date || ''}
                    onChange={e => handleFieldChange(event.tempId, 'end_date', e.target.value)}
                  />
                  {!event.all_day && (
                    <input
                      type="time"
                      value={event.end_time || ''}
                      onChange={e => handleFieldChange(event.tempId, 'end_time', e.target.value)}
                    />
                  )}
                </div>
              </div>

              <div className="field-group full">
                <label>Recurring?</label>
                <select
                  value={event.recurrence_rule || ''}
                  onChange={e => {
                    const val = e.target.value
                    handleFieldChange(event.tempId, 'is_recurring', val !== '')
                    handleFieldChange(event.tempId, 'recurrence_rule', val)
                  }}
                >
                  <option value="">Doesn't Reoccur</option>
                  <option value="FREQ=DAILY">Reoccurs Daily</option>
                  <option value="FREQ=WEEKLY">Reoccurs Weekly</option>
                  <option value="FREQ=BIWEEKLY">Reoccurs Every 2 Weeks</option>
                  <option value="FREQ=MONTHLY">Reoccurs Monthly</option>
                  <option value="FREQ=YEARLY">Reoccurs Annually</option>
                  <option value="CUSTOM">Custom...</option>
                </select>
                {event.recurrence_rule === 'CUSTOM' && (
                  <div className="custom-recurrence-placeholder">
                    Custom recurrence options coming soon.
                  </div>
                )}
              </div>

           <div className="field-group full">
  <label>Label</label>
  <input
    type="text"
    value={event.label || ''}
    onChange={e => handleFieldChange(event.tempId, 'label', e.target.value)}
    placeholder="e.g., CS101, BIO-200"
  />
</div>

<div className="slider-group apply-to-all">
  <label>Apply Label to All</label>
  <label className="switch">
    <input
      type="checkbox"
      checked={applyLabelToAll}
      onChange={e => setApplyLabelToAll(e.target.checked)}
    />
    <span className="slider"></span>
  </label>
</div>


              <div className="field-group full">
                <label>Tag</label>
                <input
                  type="text"
                  value={event.tag || ''}
                  onChange={e => handleFieldChange(event.tempId, 'tag', e.target.value)}
                  placeholder="e.g., Class, Meeting"
                />
              </div>

              <div className="field-group full">
                <label>Description</label>
                <textarea
                  value={event.description || ''}
                  onChange={e => handleFieldChange(event.tempId, 'description', e.target.value)}
                  placeholder="Enter details"
                />
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

        {error && <div className="confirmation-error">{error}</div>}

        <button onClick={handleAddEvent} className="btn btn-secondary add-event-btn" disabled={loading}>
          + Add Another Event
        </button>

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
  )
}
