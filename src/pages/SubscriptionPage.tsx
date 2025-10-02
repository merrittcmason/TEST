import { HamburgerMenu } from '../components/HamburgerMenu';
import './SubscriptionPage.css';

interface SubscriptionPageProps {
  onNavigate: (page: string) => void;
}

export function SubscriptionPage({ onNavigate }: SubscriptionPageProps) {
  const plans = [
    {
      name: 'Free',
      price: '$0',
      period: 'forever',
      features: [
        '500 AI tokens per month',
        '1 file upload per month',
        'Basic calendar features',
        'Week at a glance view',
      ],
      current: true,
    },
    {
      name: 'Student Pack',
      price: '$10',
      period: 'one-time',
      features: [
        '500 AI tokens per month',
        '5 total file uploads',
        'All free features',
        'Priority support',
      ],
      current: false,
    },
    {
      name: 'Pro',
      price: '$20',
      period: 'per month',
      features: [
        '5,000 AI tokens per month',
        '4 file uploads per month',
        'All free features',
        'Advanced calendar views',
        'Export to .ics',
        '24/7 priority support',
      ],
      current: false,
    },
  ];

  return (
    <div className="subscription-page">
      <HamburgerMenu onNavigate={onNavigate} />

      <div className="subscription-container">
        <header className="subscription-header">
          <h1 className="subscription-title">Subscription</h1>
          <p className="subscription-subtitle">
            Choose the plan that works best for you
          </p>
        </header>

        <main className="subscription-content">
          <div className="plans-grid">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`plan-card ${plan.current ? 'current' : ''}`}
              >
                {plan.current && <div className="current-badge">Current Plan</div>}

                <div className="plan-header">
                  <h3 className="plan-name">{plan.name}</h3>
                  <div className="plan-price">
                    <span className="price">{plan.price}</span>
                    <span className="period">/ {plan.period}</span>
                  </div>
                </div>

                <ul className="plan-features">
                  {plan.features.map((feature, index) => (
                    <li key={index}>
                      <svg
                        className="check-icon"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                <button
                  className={`btn ${plan.current ? 'btn-secondary' : 'btn-primary'}`}
                  disabled={plan.current}
                >
                  {plan.current ? 'Current Plan' : 'Upgrade'}
                </button>
              </div>
            ))}
          </div>

          <div className="subscription-info">
            <h2 className="section-title">Billing Information</h2>
            <div className="info-card">
              <p className="info-text">
                To upgrade your plan, please configure Stripe by adding your Stripe publishable key to the environment variables.
              </p>
              <p className="info-text">
                Once configured, you'll be able to manage your subscription, update payment methods, and view billing history.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
