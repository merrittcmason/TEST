import { useState, useEffect } from 'react';
import { HamburgerMenu } from '../components/HamburgerMenu';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import './AccountPage.css';

interface AccountPageProps {
  onNavigate: (page: string) => void;
}

export function AccountPage({ onNavigate }: AccountPageProps) {
  const { user, signOut } = useAuth();
  const [userData, setUserData] = useState<any>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) return;

    const loadUserData = async () => {
      try {
        const data = await DatabaseService.getUser(user.id);
        setUserData(data);
        setName(data?.name || '');
      } catch (error) {
        console.error('Failed to load user data:', error);
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
      await DatabaseService.updateUser(user.id, { name });
      setMessage('Profile updated successfully');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
      return;
    }

    try {
      await signOut();
    } catch (error) {
      console.error('Failed to delete account:', error);
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
              <div className="form-group">
                <label htmlFor="name">Name</label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                />
              </div>

              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={user?.email || ''}
                  disabled
                />
              </div>

              {message && (
                <div className={`message ${message.includes('success') ? 'success' : 'error'}`}>
                  {message}
                </div>
              )}

              <button
                onClick={handleSave}
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </section>

          <section className="account-section">
            <h2 className="section-title">Plan</h2>
            <div className="account-card">
              <div className="plan-info">
                <div className="plan-name">{userData?.plan_type.charAt(0).toUpperCase() + userData?.plan_type.slice(1)} Plan</div>
                <button
                  onClick={() => onNavigate('subscription')}
                  className="btn btn-secondary"
                >
                  Manage Subscription
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
                <button
                  onClick={handleDeleteAccount}
                  className="btn btn-danger"
                >
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
