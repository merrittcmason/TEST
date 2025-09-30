import { useEffect } from 'react';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
  userName: string;
  onComplete: () => void;
}

export function WelcomeScreen({ userName, onComplete }: WelcomeScreenProps) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 2000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="welcome-screen">
      <h1 className="welcome-text">Welcome back, {userName}!</h1>
    </div>
  );
}
