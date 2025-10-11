import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { DatabaseService } from '../services/database';
import { supabase } from '../lib/supabase';
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

function validUsernameFormat(v: string) {
  return /^[A-Za-z][A-Za-z0-9_]{3,11}$/.test(v);
}

function validEmailDotCom(v: string) {
  const e = v.toLowerCase().trim();
  if (!e.includes('@')) return false;
  return e.endsWith('.com');
}

function parseIntSafe(s: string) {
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function isValidDate(y: number, m: number, d: number) {
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function ageOnDate(y: number, m: number, d: number, ref: Date) {
  let a = ref.getFullYear() - y;
  const mm = ref.getMonth() + 1;
  const dd = ref.getDate();
  if (mm < m || (mm === m && dd < d)) a--;
  return a;
}

export function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signinError, setSigninError] = useState('');
  const [loading, setLoading] = useState(false);

  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [usernameChecking, setUsernameChecking] = useState(false);

  const [email2, setEmail2] = useState('');
  const [email2Touched, setEmail2Touched] = useState(false);

  const [pw1, setPw1] = useState('');
  const [pw1Active, setPw1Active] = useState(false);
  const [pw2, setPw2] = useState('');
  const [pw2Active, setPw2Active] = useState(false);

  const [dobMonth, setDobMonth] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [dobTouchedM, setDobTouchedM] = useState(false);
  const [dobTouchedD, setDobTouchedD] = useState(false);
  const [dobTouchedY, setDobTouchedY] = useState(false);

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
  const pwMatch = pw1.length > 0 && pw2.length > 0 && pw1 === pw2;

  const usernameFormatOk = validUsernameFormat(username.trim());
  const email2Valid = validEmailDotCom(email2);

  const mNum = parseIntSafe(dobMonth);
  const dNum = parseIntSafe(dobDay);
  const yNum = parseIntSafe(dobYear);
  const fullDateValid = mNum !== null && dNum !== null && yNum !== null && isValidDate(yNum, mNum, dNum);
  const today = new Date();
  const ageValid =
    fullDateValid &&
    (() => {
      const age = ageOnDate(yNum as number, mNum as number, dNum as number, today);
      return age >= 9 && age <= 105;
    })();

  const dobFieldValidM = mNum !== null && mNum >= 1 && mNum <= 12;
  const dobFieldValidD = dNum !== null && dNum >= 1 && dNum <= 31 && (mNum === null || isValidDate(yNum ?? 2000, mNum, dNum));
  const dobFieldValidY =
    yNum !== null &&
    yNum >= today.getFullYear() - 105 &&
    yNum <= today.getFullYear() - 9;

  useEffect(() => {
    let t: any;
    const val = username.trim();
    if (!val || !usernameFormatOk) {
      setUsernameAvailable(null);
      setUsernameChecking(false);
      return;
    }
    setUsernameChecking(true);
    t = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id')
          .ilike('username', val)
          .limit(1);
        if (error) {
          setUsernameAvailable(null);
        } else {
          setUsernameAvailable((data || []).length === 0);
        }
      } catch {
        setUsernameAvailable(null);
      } finally {
        setUsernameChecking(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [username, usernameFormatOk]);

  const signupInvalid =
    !usernameFormatOk ||
    usernameAvailable !== true ||
    !email2Valid ||
    !pw1 ||
    !pw2 ||
    !pwMatch ||
    !dobFieldValidM ||
    !dobFieldValidD ||
    !dobFieldValidY ||
    !fullDateValid ||
    !ageValid ||
    !agreeTos ||
    !agreePrivacy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigninError('');
    setSignupError('');
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
      } else {
        if (signupInvalid) throw new Error('Please fix the highlighted fields');
        const dob = `${String(dobYear).padStart(4, '0')}-${String(dobMonth).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`;
        await signUp(email2.trim().toLowerCase(), pw1, username.trim());
        await DatabaseService.upsertUserOnSignup({
          email: email2.trim().toLowerCase(),
          username: username.trim(),
          dob,
          marketingOptIn: optInEmail,
          tosAgreed: agreeTos,
          privacyAgreed: agreePrivacy,
          provider: 'password'
        });
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

  const usernameClass =
    usernameTouched && (!usernameFormatOk || usernameAvailable === false)
      ? 'error'
      : usernameFormatOk && usernameAvailable === true
      ? 'valid'
      : '';

  const email2Class =
    email2Touched && !email2Valid ? 'error' : email2Valid ? 'valid' : '';

  const pw2Class =
    pw2Active && !pwMatch ? 'error' : pwMatch ? 'valid' : '';

  const dobMClass =
    dobTouchedM && !dobFieldValidM ? 'error' : dobFieldValidM ? 'valid' : '';
  const dobDClass =
    dobTouchedD && !dobFieldValidD ? 'error' : dobFieldValidD ? 'valid' : '';
  const dobYClass =
    dobTouchedY && !dobFieldValidY ? 'error' : dobFieldValidY ? 'valid' : '';

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
                <div className="auth-input">
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
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <div className="auth-input">
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
                <div className={`auth-input ${usernameClass}`}>
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={() => setUsernameTouched(true)}
                    placeholder="yourname"
                  />
                  {usernameChecking && <span className="input-status warn">•</span>}
                  {usernameTouched && !usernameFormatOk && <span className="input-status err">!</span>}
                  {usernameFormatOk && usernameAvailable === true && <span className="input-status ok">✓</span>}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="email2">Email</label>
                <div className={`auth-input ${email2Class}`}>
                  <input
                    id="email2"
                    type="email"
                    autoComplete="email"
                    value={email2}
                    onChange={(e) => setEmail2(e.target.value)}
                    onFocus={() => setEmail2Touched(true)}
                    placeholder="you@example.com"
                    inputMode="email"
                  />
                  {email2Valid && <span className="input-status ok">✓</span>}
                  {email2Touched && !email2Valid && <span className="input-status err">!</span>}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="pw1">Password</label>
                <div className={`auth-input ${pw1 ? 'valid' : ''}`}>
                  <input
                    id="pw1"
                    type="password"
                    autoComplete="new-password"
                    value={pw1}
                    onFocus={() => setPw1Active(true)}
                    onChange={(e) => setPw1(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div className="password-meter">
                  <div className={`password-meter-fill ${pwStrength}`} />
                </div>
                {(pw1Active || pw1.length > 0) && (
                  <div className="password-requirements">
                    <div className={`req ${reqLen ? 'ok' : ''}`}>8+ characters</div>
                    <div className={`req ${reqLower ? 'ok' : ''}`}>1 lowercase</div>
                    <div className={`req ${reqUpper ? 'ok' : ''}`}>1 uppercase</div>
                    <div className={`req ${reqDigit ? 'ok' : ''}`}>1 digit</div>
                    <div className={`req ${reqSymbol ? 'ok' : ''}`}>1 symbol</div>
                    <div className={`req ${pwMatch ? 'ok' : ''}`}>Passwords match</div>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="pw2">Re-enter password</label>
                <div className={`auth-input ${pw2Class}`}>
                  <input
                    id="pw2"
                    type="password"
                    autoComplete="new-password"
                    value={pw2}
                    onFocus={() => setPw2Active(true)}
                    onChange={(e) => setPw2(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                {pw2Active && !pwMatch && <div className="auth-error">Passwords do not match</div>}
              </div>

              <div className="form-group">
                <label>Date of birth</label>
                <div className="dob-row">
                  <div className={`auth-input ${dobMClass}`}>
                    <input
                      type="text"
                      placeholder="MM"
                      inputMode="numeric"
                      value={dobMonth}
                      onFocus={() => setDobTouchedM(true)}
                      onChange={(e) => setDobMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    />
                  </div>
                  <div className={`auth-input ${dobDClass}`}>
                    <input
                      type="text"
                      placeholder="DD"
                      inputMode="numeric"
                      value={dobDay}
                      onFocus={() => setDobTouchedD(true)}
                      onChange={(e) => setDobDay(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    />
                  </div>
                  <div className={`auth-input ${dobYClass}`}>
                    <input
                      type="text"
                      placeholder="YYYY"
                      inputMode="numeric"
                      value={dobYear}
                      onFocus={() => setDobTouchedY(true)}
                      onChange={(e) => setDobYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    />
                  </div>
                </div>
                {dobTouchedM || dobTouchedD || dobTouchedY ? (
                  !fullDateValid ? (
                    <div className="auth-error">Enter a valid date</div>
                  ) : !ageValid ? (
                    <div className="auth-error">You must be between 9 and 105 years old</div>
                  ) : null
                ) : null}
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
                <button type="submit" className="btn btn-primary auth-submit" disabled={loading || signupInvalid || usernameChecking}>
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
