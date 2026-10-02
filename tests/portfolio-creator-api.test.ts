import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyCreatorState, type CreatorSession } from '../src/lib/portfolio-creator-state';
import { sampleAnswers, profiledState } from './fixtures/investor-profile';
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), interview: vi.fn(), auth: vi.fn() }));
vi.mock('../src/lib/api-auth', () => ({ authenticateRequest: mocks.auth }));
vi.mock('../src/lib/auth', () => ({ assertSameOrigin: vi.fn() }));
vi.mock('../src/lib/portfolio-creator-store', () => ({ loadCreatorSession: mocks.load, saveCreatorSession: mocks.save, CreatorConflictError: class CreatorConflictError extends Error {} }));
vi.mock('../src/lib/portfolio-creator-gemini', () => ({ interviewPortfolioStrategy: mocks.interview, PortfolioCreatorConfigurationError: class PortfolioCreatorConfigurationError extends Error {} }));
vi.mock('../src/lib/db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) } }));
import { CreatorConflictError } from '../src/lib/portfolio-creator-store';
import { POST, PATCH } from '../src/app/api/thesis/portfolio-creator/route';
import { POST as legacyDraft } from '../src/app/api/thesis/strategy-chat/draft/route';
let stored: CreatorSession;
const request = (body: unknown, method = 'POST') => new Request('http://localhost/api/thesis/portfolio-creator', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); stored = { revision: 0, state: emptyCreatorState() };
  mocks.auth.mockResolvedValue({ ok: true, auth: { userId: 'tenant-owner' } });
  mocks.load.mockImplementation(async () => structuredClone(stored));
  mocks.save.mockImplementation(async (_owner: string, revision: number, state: CreatorSession['state']) => { if (revision !== stored.revision) throw new CreatorConflictError('Saved conversation changed'); stored = { revision: revision + 1, state }; return stored; });
});
describe('Portfolio Creator server gates', () => {
  it('does not call the model for an unprofiled investor', async () => {
    const response = await POST(request({ revision: 0, message: 'Generate a strategy now' }));
    expect(response.status).toBe(422); expect(mocks.interview).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('does not accept a client-supplied score or draft through the compatibility endpoint', async () => {
    const response = await legacyDraft(request({ score: 75, investorProfile: { answers: sampleAnswers }, draft: { title: 'Bypass' } }));
    expect(response.status).toBe(400); expect(mocks.load).not.toHaveBeenCalled();
  });
  it('passes the saved deterministic profile to the model and retains failed user turns for retry', async () => {
    stored = { revision: 12, state: profiledState() };
    mocks.interview.mockRejectedValue(new Error('Provider timeout'));
    const response = await POST(request({ revision: 12, message: 'Brazilian listed equities, no leverage' }));
    expect(response.status).toBe(502);
    expect(mocks.interview.mock.calls[0][1]).toMatchObject({ score: 48, suggestedAllocation: { stocks: 50, bonds: 50 } });
    expect(stored.state.messages.at(-1)?.content).toBe('Brazilian listed equities, no leverage');
    expect(stored.state.generationStatus).toBe('failed');
    mocks.interview.mockResolvedValue({ status: 'clarifying', reply: 'What is the goal?', missingFields: ['Goal'], draft: null });
    await POST(request({ revision: stored.revision, retry: true }));
    expect(stored.state.messages.filter(message => message.role === 'user')).toHaveLength(1);
  });
  it('fences a stopped model turn so it cannot publish a late response', async () => {
    stored = { revision: 12, state: profiledState() };
    let finish!: (value: unknown) => void;
    mocks.interview.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = POST(request({ revision: 12, message: 'Draft a Brazilian equity sleeve' }));
    await vi.waitFor(() => expect(mocks.interview).toHaveBeenCalled());
    expect(stored.state.generationStatus).toBe('working');
    const cancelled = await PATCH(request({ action: 'cancel_turn', revision: stored.revision }, 'PATCH'));
    expect(cancelled.status).toBe(200);
    finish({ status: 'clarifying', reply: 'A late answer', missingFields: ['Goal'], draft: null });
    expect((await pending).status).toBe(409);
    expect(stored.state.generationStatus).toBe('idle');
    expect(stored.state.messages.some(message => message.content === 'A late answer')).toBe(false);
  });
  it('rejects stale revisions instead of overwriting another interview', async () => {
    stored = { revision: 5, state: profiledState() };
    const response = await PATCH(request({ action: 'restart_profile', revision: 4 }, 'PATCH'));
    expect(response.status).toBe(409); expect(mocks.save).not.toHaveBeenCalled();
  });
});
