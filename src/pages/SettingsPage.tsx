import { HamburgerMenu } from '../components/HamburgerMenu';
import { useTheme } from '../hooks/useTheme';
import './SettingsPage.css';

interface SettingsPageProps {
  onNavigate: (page: string) => void;
}

export function SettingsPage({ onNavigate }: SettingsPageProps) {
  const { theme, setTheme } = useTheme();

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
                  <option value="day">Day</option>
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
        </main>
      </div>
    </div>
  );
}
