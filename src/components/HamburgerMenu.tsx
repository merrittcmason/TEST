import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import './HamburgerMenu.css';

interface HamburgerMenuProps {
  onNavigate: (page: string) => void;
}

export function HamburgerMenu({ onNavigate }: HamburgerMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { signOut } = useAuth();

  useEffect(() => {
    const root = document.documentElement;
    if (isOpen) root.classList.add('menu-open');
    else root.classList.remove('menu-open');
    return () => root.classList.remove('menu-open');
  }, [isOpen]);

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

  return (
    <>
      <button className="hamburger-button" onClick={() => setIsOpen(!isOpen)}>
        <div className={`hamburger-icon ${isOpen ? 'open' : ''}`}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </button>

      {isOpen &&
        createPortal(
          <>
            <div className="menu-overlay" onClick={() => setIsOpen(false)} />
            <nav className="hamburger-menu slide-in-from-left">
              <ul className="menu-list">
                <li><button onClick={() => handleNavigation('settings')}>Settings</button></li>
                <li><button onClick={() => handleNavigation('account')}>Account</button></li>
                <li><button onClick={() => handleNavigation('subscription')}>Subscription</button></li>
                <li><button onClick={handleSignOut} className="sign-out-button">Sign Out</button></li>
              </ul>
            </nav>
          </>,
          document.body
        )}
    </>
  );
}
