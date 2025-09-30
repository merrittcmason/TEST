import { useState } from 'react';
import { HamburgerMenu } from '../components/HamburgerMenu';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import { format } from 'date-fns';
import './ExportPage.css';

interface ExportPageProps {
  onNavigate: (page: string) => void;
}

export function ExportPage({ onNavigate }: ExportPageProps) {
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');

  const generateICS = async () => {
    if (!user) return;

    setExporting(true);
    setMessage('');

    try {
      const events = await DatabaseService.getEvents(user.id);

      let icsContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Calendar Pilot//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:Calendar Pilot',
        'X-WR-TIMEZONE:UTC',
      ].join('\r\n');

      events.forEach((event) => {
        const dateStr = event.date.replace(/-/g, '');
        const timeStr = event.time ? event.time.replace(/:/g, '') + '00' : '000000';

        icsContent += '\r\n' + [
          'BEGIN:VEVENT',
          `DTSTART:${dateStr}T${timeStr}Z`,
          `DTEND:${dateStr}T${timeStr}Z`,
          `SUMMARY:${event.name}`,
          event.tag ? `CATEGORIES:${event.tag}` : '',
          `CREATED:${format(new Date(event.created_at), "yyyyMMdd'T'HHmmss'Z'")}`,
          `LAST-MODIFIED:${format(new Date(event.updated_at), "yyyyMMdd'T'HHmmss'Z'")}`,
          `UID:${event.id}@calendarpilot.app`,
          'SEQUENCE:0',
          'STATUS:CONFIRMED',
          'TRANSP:OPAQUE',
          'END:VEVENT',
        ].filter(Boolean).join('\r\n');
      });

      icsContent += '\r\nEND:VCALENDAR';

      const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `calendar-pilot-${format(new Date(), 'yyyy-MM-dd')}.ics`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setMessage(`Successfully exported ${events.length} events`);
    } catch (error) {
      console.error('Failed to export calendar:', error);
      setMessage('Failed to export calendar');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="export-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="export-container">
        <header className="export-header">
          <h1 className="export-title">Export Calendar</h1>
          <p className="export-subtitle">
            Download your events in standard .ics format
          </p>
        </header>

        <main className="export-content">
          <div className="export-card">
            <div className="export-icon">
              <svg
                width="64"
                height="64"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                />
              </svg>
            </div>

            <h2 className="export-card-title">Export to .ics File</h2>
            <p className="export-description">
              Download all your calendar events in iCalendar format (.ics). This file can be imported into any calendar application including Google Calendar, Apple Calendar, Outlook, and more.
            </p>

            <div className="export-features">
              <div className="feature-item">
                <svg className="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                All events and details
              </div>
              <div className="feature-item">
                <svg className="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Standard .ics format
              </div>
              <div className="feature-item">
                <svg className="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Compatible with all calendar apps
              </div>
            </div>

            {message && (
              <div className={`export-message ${message.includes('Successfully') ? 'success' : 'error'}`}>
                {message}
              </div>
            )}

            <button
              onClick={generateICS}
              className="btn btn-primary export-button"
              disabled={exporting}
            >
              {exporting ? 'Exporting...' : 'Export Calendar'}
            </button>
          </div>

          <div className="export-info">
            <h3 className="info-title">How to use your exported calendar</h3>
            <ol className="info-list">
              <li>Click the "Export Calendar" button to download your .ics file</li>
              <li>Open your preferred calendar application</li>
              <li>Look for an "Import" or "Add Calendar" option</li>
              <li>Select the downloaded .ics file</li>
              <li>Your events will be imported and appear in your calendar</li>
            </ol>
          </div>
        </main>
      </div>
    </div>
  );
}
