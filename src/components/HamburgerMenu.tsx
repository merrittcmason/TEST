import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useMode, MODE_CONFIG, type AppMode } from '../contexts/ModeContext';
import './HamburgerMenu.css';

interface HamburgerMenuProps {
  onNavigate: (page: string) => void;
}

export function HamburgerMenu({ onNavigate }: HamburgerMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showEnterpriseModal, setShowEnterpriseModal] = useState(false);
  const { signOut } = useAuth();
  const { mode, setMode } = useMode();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  };

  const handleNavigation = (page: string) => {
    onNavigate(page);
    setIsOpen(false);
  };

  const handleModeChange = async (newMode: AppMode) => {
    if (newMode === 'enterprise') {
      setShowEnterpriseModal(true);
      return;
    }
    try {
      await setMode(newMode);
    } catch (error) {
      console.error('Failed to change mode:', error);
    }
  };

  return (
    <>
      <button className="hamburger-button" onClick={() => setIsOpen(!isOpen)}>
        <div className={`hamburger-icon ${isOpen ? 'open' : ''}`}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </button>

      {isOpen && (
        <>
          <div className="menu-overlay" onClick={() => setIsOpen(false)} />
          <nav className="hamburger-menu slide-in-right">
            <div className="mode-slider">
              <div className="mode-slider-label">Mode</div>
              <div className="mode-options">
                {(['standard', 'education', 'work', 'enterprise'] as AppMode[]).map((modeOption) => (
                  <button
                    key={modeOption}
                    className={`mode-option ${mode === modeOption ? 'active' : ''}`}
                    onClick={() => handleModeChange(modeOption)}
                    title={MODE_CONFIG[modeOption].name}
                  >
                    <span className="mode-icon">{MODE_CONFIG[modeOption].icon}</span>
                    <span className="mode-name">{MODE_CONFIG[modeOption].name}</span>
                  </button>
                ))}
              </div>
            </div>
            <ul className="menu-list">
              <li>
                <button onClick={() => handleNavigation('settings')}>
                  Settings
                </button>
              </li>
              <li>
                <button onClick={() => handleNavigation('account')}>
                  Account
                </button>
              </li>
              <li>
                <button onClick={() => handleNavigation('subscription')}>
                  Subscription
                </button>
              </li>
              <li className="menu-divider"></li>
              <li>
                <button onClick={handleSignOut} className="sign-out-button">
                  Sign Out
                </button>
              </li>
            </ul>
          </nav>
        </>
      )}

      {showEnterpriseModal && (
        <div className="enterprise-modal-overlay" onClick={() => setShowEnterpriseModal(false)}>
          <div className="enterprise-modal" onClick={(e) => e.stopPropagation()}>
            <div className="enterprise-modal-content">
              <span className="enterprise-icon">🏢</span>
              <h2>Enterprise Mode</h2>
              <p>Coming Soon</p>
              <button className="btn btn-primary" onClick={() => setShowEnterpriseModal(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
