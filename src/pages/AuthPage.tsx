import { useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './AuthPage.css';

type Mode = 'signin' | 'signup';

function passwordStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 5);
}

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('signin');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signinLoading, setSigninLoading] = useState(false);

  const [username, setUsername] = useState('');
  const [password2, setPassword2] = useState('');
  const [dob, setDob] = useState('');
  const [agreeTos, setAgreeTos] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [optInEmail, setOptInEmail] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);

  const [error, setError] = useState('');

  const { signIn, signUp, signInWithOAuth } = useAuth();

  const pwdScore = useMemo(() => passwordStrength(password), [password]);
  const meetsLength = password.length >= 8;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const signupReady =
    username.trim().length > 0 &&
    email.trim().length > 0 &&
    meetsLength && hasLower && hasUpper && hasDigit && hasSymbol &&
    password === password2 &&
    dob.trim().length > 0 &&
    agreeTos && agreePrivacy;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSigninLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err: any) {
      setError(err?.message || 'Unable to sign in.');
    } finally {
      setSigninLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!signupReady) {
      setError('Please complete all required fields and meet the password rules.');
      return;
    }
    setSignupLoading(true);
    try {
      sessionStorage.setItem('pending_profile', '1');
      sessionStorage.setItem('pending_profile_email_opt_in', optInEmail ? '1' : '0');
      sessionStorage.setItem('pending_profile_dob', dob);
      await signUp(email.trim(), password, username.trim());
    } catch (err: any) {
      setError(err?.message || 'Unable to create your account.');
    } finally {
      setSignupLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github' | 'apple') => {
    setError('');
    try {
      sessionStorage.setItem('pending_profile', '1');
      await signInWithOAuth(provider);
    } catch (err: any) {
      setError(err?.message || 'Unable to continue with provider.');
    }
  };

  const switchTo = (m: Mode) => {
    setError('');
    setMode(m);
  };

  return (
    <div className="auth-page">
      <div className="auth-container" role="dialog" aria-labelledby="auth-title">
        <h1 id="auth-title" className="auth-title">Calendar Pilot</h1>

        {mode === 'signin' ? (
          <div className="auth-card" aria-live="polite">
            <h2 className="auth-card-title">Sign In</h2>

            <form onSubmit={handleSignIn} className="auth-form" autoComplete="off">
              <div className="form-group">
                <label htmlFor="signin-email">Email</label>
                <input
                  id="signin-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  name="email_signin"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="signin-password">Password</label>
                <input
                  id="signin-password"
                  type="password"
                  autoComplete="new-password"
                  name="password_signin"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
                />
              </div>

              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary auth-submit"
                disabled={signinLoading}
              >
                {signinLoading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <div className="auth-divider">
              <span>or continue with</span>
            </div>

            <div className="oauth-buttons">
              <button
                className="btn btn-secondary oauth-btn"
                onClick={() => handleOAuth('google')}
                disabled={signinLoading}
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
                disabled={signinLoading}
              >
                <svg className="oauth-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                GitHub
              </button>

              <button
                className="btn btn-secondary oauth-btn"
                onClick={() => handleOAuth('apple')}
                disabled={signinLoading}
              >
                <svg className="oauth-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                Apple
              </button>
            </div>

            <div className="auth-alt">
              <button className="link-btn" onClick={() => switchTo('signup')}>
                Create an account
              </button>
            </div>
          </div>
        ) : (
          <div className="auth-card" aria-live="polite">
            <h2 className="auth-card-title">Create an Account</h2>

            <form onSubmit={handleSignUp} className="auth-form" autoComplete="off">
              <div className="form-group">
                <label htmlFor="signup-username">Username</label>
                <input
                  id="signup-username"
                  type="text"
                  autoComplete="off"
                  name="username_signup"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="signup-email">Email</label>
                <input
                  id="signup-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  name="email_signup"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="signup-password">Password</label>
                <input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  name="password_signup"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                />
                <div className="password-meter" aria-hidden="true">
                  <div className={`bar bar-${Math.max(1, pwdScore)}`} />
                </div>
                <ul className="password-rules">
                  <li className={meetsLength ? 'ok' : ''}>8+ characters</li>
                  <li className={hasLower ? 'ok' : ''}>lowercase letter</li>
                  <li className={hasUpper ? 'ok' : ''}>uppercase letter</li>
                  <li className={hasDigit ? 'ok' : ''}>a digit</li>
                  <li className={hasSymbol ? 'ok' : ''}>a symbol</li>
                </ul>
              </div>

              <div className="form-group">
                <label htmlFor="signup-password2">Re-enter Password</label>
                <input
                  id="signup-password2"
                  type="password"
                  autoComplete="new-password"
                  name="password2_signup"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  placeholder="Re-enter password"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="signup-dob">Date of Birth</label>
                <input
                  id="signup-dob"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  name="dob_signup"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  placeholder="MM / DD / YYYY"
                />
              </div>

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={agreeTos}
                    onChange={(e) => setAgreeTos(e.target.checked)}
                  />
                  I agree to the Terms of Service
                </label>
              </div>

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={agreePrivacy}
                    onChange={(e) => setAgreePrivacy(e.target.checked)}
                  />
                  I have read the Privacy Policy
                </label>
              </div>

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={optInEmail}
                    onChange={(e) => setOptInEmail(e.target.checked)}
                  />
                  Sign me up for product updates
                </label>
              </div>

              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary auth-submit"
                disabled={!signupReady || signupLoading}
              >
                {signupLoading ? 'Creating account…' : 'Create Account'}
              </button>
            </form>

            <div className="auth-divider">
              <span>or continue with</span>
            </div>

            <div className="oauth-buttons">
              <button
                className="btn btn-secondary oauth-btn"
                onClick={() => handleOAuth('google')}
                disabled={signupLoading}
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
                disabled={signupLoading}
              >
                <svg className="oauth-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                GitHub
              </button>

              <button
                className="btn btn-secondary oauth-btn"
                onClick={() => handleOAuth('apple')}
                disabled={signupLoading}
              >
                <svg className="oauth-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                Apple
              </button>
            </div>

            <div className="auth-alt space-between">
              <button className="link-btn" onClick={() => switchTo('signin')}>
                Back to Sign In
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
