import { useEffect, useState } from 'react';
import './LaunchScreen.css';

interface LaunchScreenProps {
  onComplete: () => void;
}

export function LaunchScreen({ onComplete }: LaunchScreenProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(onComplete, 300);
          return 100;
        }
        return prev + 10;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <div className="launch-screen">
      <h1 className="launch-title">Calendar Pilot</h1>
      <div className="launch-progress-container">
        <div
          className="launch-progress-bar"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
