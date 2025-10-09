import { useEffect, useState } from 'react';
import './WelcomeScreen.css';

interface WelcomeScreenProps {
  userName: string;
  onComplete: () => void;
}

export function WelcomeScreen({ userName, onComplete }: WelcomeScreenProps) {
  const [firstTime, setFirstTime] = useState(false);

  useEffect(() => {
    const firstLoginKey = `firstLogin_${userName}`;
    if (!localStorage.getItem(firstLoginKey)) {
      setFirstTime(true);
      localStorage.setItem(firstLoginKey, 'true');
    } else {
      setFirstTime(false);
    }
  }, [userName]);

  useEffect(() => {
    const timer = setTimeout(onComplete, 2500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="welcome-screen">
      <h1 className="welcome-text">
        {firstTime ? `Welcome ${userName}!` : `Welcome back, ${userName}!`}
      </h1>
    </div>
  );
}
