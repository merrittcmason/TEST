import { useEffect, useMemo, useState } from 'react';
import { DatabaseService } from '../services/database';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../hooks/useTheme';
import './CompleteProfilePage.css';

const HOW_HEARD_OPTIONS = ['friend','social','search','app_store','ad','other'];

export function CompleteProfilePage({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mode, setMode] = useState<'personal'|'education'|'business'|'enterprise'>('personal');
  const [heard, setHeard] = useState<string>('search');
  const [saving, setSaving] = useState(false);

  const canContinue = useMemo(() => {
    return firstName.trim().length > 0 && lastName.trim().length > 0 && !saving;
  }, [firstName,lastName,saving]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!user) return;
      const u = await DatabaseService.getUser(user.id);
      if (!mounted) return;
      if (u?.first_name) setFirstName(u.first_name);
      if (u?.last_name) setLastName(u.last_name);
      const prefs = await DatabaseService.getUserPreferences(user.id);
      if (!mounted) return;
      if (prefs?.mode) setMode(prefs.mode as any);
      if (prefs?.theme_preference) setTheme(prefs.theme_preference as any);
    })();
    return () => { mounted = false; };
  }, [user, setTheme]);

  const handleContinue = async () => {
    if (!user) return;
    setSaving(true);
    await DatabaseService.updateUser(user.id, {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      how_heard: heard,
      profile_completed: true
    });
    await DatabaseService.updateUserPreferences(user.id, {
      mode,
      theme_preference: theme
    });
    setSaving(false);
    onDone();
  };

  return (
    <div className="complete-profile-page">
      <div className="cp-card">
        <div className="cp-header">
          <h1>Finish creating your profile</h1>
          <p>You can change these anytime in Settings</p>
        </div>

        <div className="cp-section">
          <label>First name</label>
          <input value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="First name" />
        </div>

        <div className="cp-section">
          <label>Last name</label>
          <input value={lastName} onChange={e=>setLastName(e.target.value)} placeholder="Last name" />
        </div>

        <div className="cp-section">
          <label>How will you use the app?</label>
          <div className="cp-modes">
            <button className={`cp-mode ${mode==='personal'?'active':''}`} onClick={()=>setMode('personal')}>Personal</button>
            <button className={`cp-mode ${mode==='education'?'active':''}`} onClick={()=>setMode('education')}>Education</button>
            <button className={`cp-mode ${mode==='business'?'active':''}`} onClick={()=>setMode('business')}>Business</button>
            <button className="cp-mode disabled">Enterprise (soon)</button>
          </div>
        </div>

        <div className="cp-section">
          <label>Theme</label>
          <div className="cp-themes">
            <button className={`cp-theme ${theme==='light'?'active':''}`} onClick={()=>setTheme('light')}>Light</button>
            <button className={`cp-theme ${theme==='dark'?'active':''}`} onClick={()=>setTheme('dark')}>Dark</button>
            <button className={`cp-theme ${theme==='system'?'active':''}`} onClick={()=>setTheme('system')}>System</button>
          </div>
        </div>

        <div className="cp-section">
          <label>How did you hear about us?</label>
          <select value={heard} onChange={e=>setHeard(e.target.value)}>
            {HOW_HEARD_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        <button className="cp-continue" onClick={handleContinue} disabled={!canContinue}>{saving?'Saving...':'Continue'}</button>
      </div>
    </div>
  );
}
