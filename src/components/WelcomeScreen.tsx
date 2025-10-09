import { useEffect } from 'react';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
  userName: string;
  onComplete: () => void;
  firstTime?: boolean;
}

export function WelcomeScreen({ userName, onComplete, firstTime = false }: WelcomeScreenProps) {
  useEffect(() => {
    const t = setTimeout(onComplete, 1600);
    return () => clearTimeout(t);
  }, [onComplete]);
  return (
    <div className="welcome-screen">
      <h1 className="welcome-text">{firstTime ? `Welcome ${userName}!` : `Welcome back, ${userName}!`}</h1>
    </div>
  );
}
