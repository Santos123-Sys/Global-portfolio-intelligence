'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [mfa, setMfa] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const f = new FormData(event.currentTarget);
    try {
      const res = await fetch('/api/auth/session', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: f.get('email'), password: f.get('password'), ...(mfa ? { mfaCode: f.get('mfaCode') } : {}) }) });
      const data = await res.json();
      if (res.status === 202 && data.mfaRequired) setMfa(true);
      else if (!res.ok) setError(data.error ?? 'Sign-in unavailable');
      else { router.replace('/'); router.refresh(); }
    } catch { setError('Sign-in service unavailable. Please try again.'); } finally { setBusy(false); }
  }
  return <main className="login"><div className="brand">GPI <span>FOUNDATION / 01</span></div><h1>Discovery starts<br />with evidence.</h1>
    <p>USA / SEC · Brazil / CVM<br />Financial analysis and valuation by FilingLens.</p>
    <form onSubmit={submit} className="card"><h2>Sign in to your workspace</h2><label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
      {mfa && <label>Authenticator or recovery code<input name="mfaCode" autoComplete="one-time-code" required maxLength={64} /></label>}
      {error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <small>Existing accounts are retained. New access is provisioned by the administrator.</small></form></main>;
}
