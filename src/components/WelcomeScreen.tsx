import { useEffect } from 'react';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
  firstName: string;
  onComplete: () => void;
  firstTime?: boolean;
}

export function WelcomeScreen({ firstName, onComplete, firstTime = false }: WelcomeScreenProps) {
  useEffect(() => {
    const t = setTimeout(onComplete, 3000);
    return () => clearTimeout(t);
  }, [onComplete]);

  return (
    <div className="welcome-screen">
      <h1 className="welcome-text">
        {firstTime ? `Welcome ${firstName}!` : `Welcome back, ${firstName}!`}
      </h1>
    </div>
  );
}
