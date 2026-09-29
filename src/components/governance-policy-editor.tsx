'use client';

import { useEffect, useState } from 'react';

interface Policy { maxPositionWeight: number; maxSectorWeight: number; maxCountryWeight: number; minimumHoldings: number; stalePriceDays: number; staleResearchDays: number; reviewIntervalDays: number; }

export function GovernancePolicyEditor() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/governance?view=policy', { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({})) as { policy?: Policy; error?: string };
        if (!response.ok || !body.policy) throw new Error(body.error ?? 'Unable to load monitoring guardrails.');
        if (active) setPolicy(body.policy);
      })
      .catch(error => { if (active) setMessage((error as Error).message); });
    return () => { active = false; };
  }, []);

  function update(key: keyof Policy, value: string, percentInput = false) {
    setPolicy(current => current ? { ...current, [key]: percentInput ? Number(value) / 100 : Number(value) } : current);
  }

  async function save() {
    if (!policy) return;
    setSaving(true); setMessage(null);
    const response = await fetch('/api/governance', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(policy),
    }).catch(() => null);
    const body = await response?.json().catch(() => ({})) as { error?: string } | undefined;
    setMessage(response?.ok ? 'Monitoring guardrails saved.' : body?.error ?? 'Unable to save monitoring guardrails.');
    setSaving(false);
  }

  if (!policy) return <p className={message ? 'caveat' : 'note'} role="status">{message ?? 'Loading optional guardrails…'}</p>;
  return <div>
    <div className="governance-policy-grid">
      <label>Maximum position (%)<input type="number" min="2" max="100" value={(policy.maxPositionWeight * 100).toFixed(0)} onChange={event => update('maxPositionWeight', event.target.value, true)} /></label>
      <label>Maximum sector (%)<input type="number" min="5" max="100" value={(policy.maxSectorWeight * 100).toFixed(0)} onChange={event => update('maxSectorWeight', event.target.value, true)} /></label>
      <label>Maximum country (%)<input type="number" min="5" max="100" value={(policy.maxCountryWeight * 100).toFixed(0)} onChange={event => update('maxCountryWeight', event.target.value, true)} /></label>
      <label>Minimum holdings<input type="number" min="1" max="100" value={policy.minimumHoldings} onChange={event => update('minimumHoldings', event.target.value)} /></label>
      <label>Price stale after (days)<input type="number" min="1" max="30" value={policy.stalePriceDays} onChange={event => update('stalePriceDays', event.target.value)} /></label>
      <label>Research stale after (days)<input type="number" min="7" max="730" value={policy.staleResearchDays} onChange={event => update('staleResearchDays', event.target.value)} /></label>
      <label>Review interval (days)<input type="number" min="7" max="365" value={policy.reviewIntervalDays} onChange={event => update('reviewIntervalDays', event.target.value)} /></label>
    </div>
    <button className="action-button" type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save monitoring guardrails'}</button>
    {message && <p className={message.includes('saved') ? 'security-state' : 'caveat'} role="status">{message}</p>}
  </div>;
}
