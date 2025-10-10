import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './AuthPage.css';

function scorePassword(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[a-z]/.test(pw)) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (s >= 5) return 'strong';
  if (s >= 3) return 'fair';
  if (s >= 1) return 'weak';
  return '';
}

export function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signinError, setSigninError] = useState('');
  const [loading, setLoading] = useState(false);

  const [username, setUsername] = useState('');
  const [email2, setEmail2] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [agreeTos, setAgreeTos] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [optInEmail, setOptInEmail] = useState(false);
  const [signupError, setSignupError] = useState('');

  const { signIn, signUp, signInWithOAuth } = useAuth();

  const pwStrength = useMemo(() => scorePassword(pw1), [pw1]);
  const reqLen = pw1.length >= 8;
  const reqLower = /[a-z]/.test(pw1);
  const reqUpper = /[A-Z]/.test(pw1);
  const reqDigit = /\d/.test(pw1);
  const reqSymbol = /[^A-Za-z0-9]/.test(pw1);
  const pwMatch = pw1 && pw2 && pw1 === pw2;

  const signupInvalid =
    !username.trim() ||
    !email2.trim() ||
    !pw1 ||
    !pw2 ||
    !pwMatch ||
    !(reqLen && reqLower && reqUpper && reqDigit && reqSymbol) ||
    !agreeTos ||
    !agreePrivacy ||
    !dobMonth ||
    !dobDay ||
    !dobYear;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigninError('');
    setSignupError('');
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        await signUp(email2, pw1, username.trim());
      }
    } catch (err: any) {
      if (mode === 'signin') setSigninError(err?.message || 'An error occurred');
      else setSignupError(err?.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github' | 'apple') => {
    setSigninError('');
    setSignupError('');
    setLoading(true);
    try {
      await signInWithOAuth(provider);
    } catch (err: any) {
      setSigninError(err?.message || 'An error occurred');
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className={`auth-container ${mode === 'signup' ? 'signup' : 'signin'}`}>
        {mode === 'signup' && (
          <div className="back-top">
            <button type="button" className="back-btn" onClick={() => setMode('signin')}>
              <span className="back-icon">←</span>
              <span>Back</span>
            </button>
          </div>
        )}

        <h1 className="auth-title">Calendar Pilot</h1>

        {mode === 'signin' ? (
          <>
            <form onSubmit={handleSubmit} className="auth-form" autoComplete="off">
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                />
              </div>

              {signinError && <div className="auth-error">{signinError}</div>}

              <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
                {loading ? 'Loading...' : 'Sign In'}
              </button>
            </form>

            <div className="auth-divider">
              <span>or continue with</span>
            </div>

            <div className="oauth-buttons">
              <button
                className="btn btn-secondary oauth-btn"
                onClick={() => handleOAuth('google')}
                disabled={loading}
              >
                <svg className="oauth-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google
              </button>

              <button
                className="btn btn-secondary oauth-btn"
                onClick={() => handleOAuth('github')}
                disabled={loading}
              >
                <svg className="oauth-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                GitHub
              </button>

              <button
                className="btn btn-secondary oauth-btn"
                onClick={() => handleOAuth('apple')}
                disabled={loading}
              >
                <svg className="oauth-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                Apple
              </button>
            </div>

            <div className="auth-alt">
              <div className="create-account-row">
                <button type="button" className="link-btn" onClick={() => setMode('signup')}>
                  Create an account
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="auth-form signup-form" autoComplete="off">
              <div className="form-group">
                <label htmlFor="username">Username</label>
                <div className={`auth-input ${username.trim() ? 'valid' : ''}`}>
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="yourname"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="email2">Email</label>
                <div className={`auth-input ${email2.trim() ? 'valid' : ''}`}>
                  <input
                    id="email2"
                    type="email"
                    autoComplete="email"
                    value={email2}
                    onChange={(e) => setEmail2(e.target.value)}
                    placeholder="you@example.com"
                    inputMode="email"
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="pw1">Password</label>
                <div className={`auth-input ${reqLen && reqLower && reqUpper && reqDigit && reqSymbol ? 'valid' : ''}`}>
                  <input
                    id="pw1"
                    type="password"
                    autoComplete="new-password"
                    value={pw1}
                    onChange={(e) => setPw1(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div className="password-meter">
                  <div className={`password-meter-fill ${pwStrength}`} />
                </div>
                <div className="password-requirements">
                  <div className={`req ${reqLen ? 'ok' : ''}`}>8+ characters</div>
                  <div className={`req ${reqLower ? 'ok' : ''}`}>1 lowercase</div>
                  <div className={`req ${reqUpper ? 'ok' : ''}`}>1 uppercase</div>
                  <div className={`req ${reqDigit ? 'ok' : ''}`}>1 digit</div>
                  <div className={`req ${reqSymbol ? 'ok' : ''}`}>1 symbol</div>
                  <div className={`req ${pwMatch ? 'ok' : ''}`}>Passwords match</div>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="pw2">Re-enter password</label>
                <div className={`auth-input ${pwMatch ? 'valid' : ''} ${pw2 && !pwMatch ? 'error' : ''}`}>
                  <input
                    id="pw2"
                    type="password"
                    autoComplete="new-password"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Date of birth</label>
                <div className="dob-row">
                  <div className="auth-input">
                    <input
                      type="text"
                      placeholder="MM"
                      inputMode="numeric"
                      value={dobMonth}
                      onChange={(e) => setDobMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    />
                  </div>
                  <div className="auth-input">
                    <input
                      type="text"
                      placeholder="DD"
                      inputMode="numeric"
                      value={dobDay}
                      onChange={(e) => setDobDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    />
                  </div>
                  <div className="auth-input">
                    <input
                      type="text"
                      placeholder="YYYY"
                      inputMode="numeric"
                      value={dobYear}
                      onChange={(e) => setDobYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    />
                  </div>
                </div>
              </div>

              <div className="terms-box">
                <label className="terms-item">
                  <input type="checkbox" checked={agreeTos} onChange={(e) => setAgreeTos(e.target.checked)} />
                  I agree to the Terms of Service
                </label>
                <label className="terms-item">
                  <input type="checkbox" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} />
                  I have read the Privacy Policy
                </label>
                <label className="terms-item">
                  <input type="checkbox" checked={optInEmail} onChange={(e) => setOptInEmail(e.target.checked)} />
                  Sign me up for product updates
                </label>
              </div>

              {signupError && <div className="auth-error">{signupError}</div>}

              <div className="signup-actions">
                <button type="submit" className="btn btn-primary auth-submit" disabled={loading || signupInvalid}>
                  {loading ? 'Loading...' : 'Create Account'}
                </button>
              </div>
            </form>

            <div className="auth-divider">
              <span>or continue with</span>
            </div>

            <div className="oauth-buttons">
              <button className="btn btn-secondary oauth-btn" onClick={() => handleOAuth('google')} disabled={loading}>
                <svg className="oauth-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google
              </button>

              <button className="btn btn-secondary oauth-btn" onClick={() => handleOAuth('github')} disabled={loading}>
                <svg className="oauth-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                GitHub
              </button>

              <button className="btn btn-secondary oauth-btn" onClick={() => handleOAuth('apple')} disabled={loading}>
                <svg className="oauth-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                Apple
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
