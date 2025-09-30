import { useEffect, useState } from 'react';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import './SubscriptionCard.css';

export function SubscriptionCard() {
  const { user } = useAuth();
  const [userData, setUserData] = useState<any>(null);
  const [tokenUsage, setTokenUsage] = useState<any>(null);
  const [uploadQuota, setUploadQuota] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      try {
        const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
        const [userDataResult, tokenData, uploadData] = await Promise.all([
          DatabaseService.getUser(user.id),
          DatabaseService.getTokenUsage(user.id, currentMonth),
          DatabaseService.getUploadQuota(user.id, currentMonth),
        ]);

        setUserData(userDataResult);
        setTokenUsage(tokenData);
        setUploadQuota(uploadData);
      } catch (error) {
        console.error('Failed to load subscription data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user]);

  if (loading || !userData) {
    return (
      <div className="subscription-card">
        <div className="loading-spinner" />
      </div>
    );
  }

  const tokenPercentage = tokenUsage
    ? (tokenUsage.tokens_used / tokenUsage.tokens_limit) * 100
    : 0;

  const getSliderColor = (percentage: number) => {
    if (percentage < 70) return 'var(--success)';
    if (percentage < 90) return 'var(--warning)';
    return 'var(--error)';
  };

  const getPlanDisplay = (planType: string) => {
    switch (planType) {
      case 'free': return 'Free Plan';
      case 'student': return 'Student Pack';
      case 'pro': return 'Pro Plan';
      default: return 'Free Plan';
    }
  };

  return (
    <div className="subscription-card">
      <div className="subscription-header">
        <h3>{userData.name || user?.email}</h3>
        <span className="plan-badge">{getPlanDisplay(userData.plan_type)}</span>
      </div>

      <div className="quota-section">
        <div className="quota-header">
          <span className="quota-label">AI Tokens</span>
          <span className="quota-value">
            {tokenUsage?.tokens_used || 0} / {tokenUsage?.tokens_limit || 0}
          </span>
        </div>
        <div className="quota-slider-container">
          <div
            className="quota-slider-fill"
            style={{
              width: `${Math.min(tokenPercentage, 100)}%`,
              backgroundColor: getSliderColor(tokenPercentage),
            }}
          />
        </div>
      </div>

      <div className="quota-section">
        <div className="quota-header">
          <span className="quota-label">File Uploads</span>
          <span className="quota-value">
            {uploadQuota?.uploads_used || 0} / {uploadQuota?.uploads_limit || 0} remaining
          </span>
        </div>
      </div>
    </div>
  );
}
