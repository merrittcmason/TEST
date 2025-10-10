import { useState, useEffect } from 'react';
import { HamburgerMenu } from '../components/HamburgerMenu';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import './AccountPage.css';

interface AccountPageProps {
  onNavigate: (page: string) => void;
}

const HOW_HEARD_OPTIONS = ['friend','social','search','app_store','ad','other'];

export function AccountPage({ onNavigate }: AccountPageProps) {
  const { user, signOut } = useAuth();
  const [userData, setUserData] = useState<any>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [dob, setDob] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [howHeard, setHowHeard] = useState<string>('search');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    const loadUserData = async () => {
      try {
        const data = await DatabaseService.getUser(user.id);
        setUserData(data);
        setFirstName(data?.first_name || '');
        setLastName(data?.last_name || '');
        setUsername(data?.username || '');
        setDob(data?.dob || '');
        setMarketingOptIn(!!data?.marketing_opt_in);
        setHowHeard(data?.how_heard || 'search');
      } catch {
      } finally {
        setLoading(false);
      }
    };
    loadUserData();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setMessage('');
    try {
      const updated = await DatabaseService.updateUser(user.id, {
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        username: username.trim() || null,
        dob: dob || null,
        marketing_opt_in: marketingOptIn,
        how_heard: howHeard || null
      } as any);
      setUserData(updated);
      setMessage('Profile updated successfully');
      setTimeout(() => setMessage(''), 3000);
    } catch {
      setMessage('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm('Are you sure you want to delete your account? This action cannot be undone.')) return;
    try {
      await signOut();
    } catch {
    }
  };

  if (loading) {
    return (
      <div className="account-page">
        <HamburgerMenu onNavigate={onNavigate} />
        <div className="loading-container">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="account-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="account-container">
        <header className="account-header">
          <h1 className="account-title">Account</h1>
        </header>

        <main className="account-content">
          <section className="account-section">
            <h2 className="section-title">Profile</h2>
            <div className="account-card">
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="first_name">First name</label>
                  <input
                    id="first_name"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First name"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="last_name">Last name</label>
                  <input
                    id="last_name"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last name"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="yourname"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <input id="email" type="email" value={user?.email || ''} disabled />
                </div>

                <div className="form-group">
                  <label htmlFor="dob">Date of birth</label>
                  <input
                    id="dob"
                    type="date"
                    value={dob || ''}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="how_heard">How did you hear about us?</label>
                  <select id="how_heard" value={howHeard} onChange={(e) => setHowHeard(e.target.value)}>
                    {HOW_HEARD_OPTIONS.map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group checkbox-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={marketingOptIn}
                      onChange={(e) => setMarketingOptIn(e.target.checked)}
                    />
                    Sign me up for product updates
                  </label>
                </div>

                <div className="form-group">
                  <label htmlFor="provider">Account provider</label>
                  <input
                    id="provider"
                    type="text"
                    value={userData?.account_provider || 'password'}
                    disabled
                  />
                </div>
              </div>

              {message && (
                <div className={`message ${message.includes('success') ? 'success' : 'error'}`}>
                  {message}
                </div>
              )}

              <button onClick={handleSave} className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </section>

          <section className="account-section">
            <h2 className="section-title">Subscription</h2>
            <div className="plan-card">
              <div className="plan-card-header">
                <div className="plan-badge">
                  {userData?.plan_type === 'free' ? 'Standard' : 'Pro'} Plan
                </div>
              </div>
              <div className="plan-card-body">
                <div className="plan-features">
                  {userData?.plan_type === 'free' ? (
                    <>
                      <div className="plan-feature">
                        <svg className="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        500 AI tokens per month
                      </div>
                      <div className="plan-feature">
                        <svg className="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        1 file upload per month
                      </div>
                      <div className="plan-feature">
                        <svg className="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Basic calendar features
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="plan-feature">
                        <svg className="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Unlimited AI tokens
                      </div>
                      <div className="plan-feature">
                        <svg className="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Unlimited file uploads
                      </div>
                      <div className="plan-feature">
                        <svg className="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Priority support
                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => onNavigate('subscription')} className="btn btn-primary plan-btn">
                  {userData?.plan_type === 'free' ? 'Upgrade to Pro' : 'Manage Subscription'}
                </button>
              </div>
            </div>
          </section>

          <section className="account-section">
            <h2 className="section-title danger-section">Danger Zone</h2>
            <div className="account-card danger-card">
              <div className="danger-info">
                <div>
                  <h3 className="danger-title">Delete Account</h3>
                  <p className="danger-description">
                    Permanently delete your account and all associated data. This action cannot be undone.
                  </p>
                </div>
                <button onClick={handleDeleteAccount} className="btn btn-danger">
                  Delete Account
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
