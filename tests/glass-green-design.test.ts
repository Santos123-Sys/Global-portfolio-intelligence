import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf8');
const shell = readFileSync('src/components/app-shell.tsx', 'utf8');
const allocation = readFileSync('src/app/allocation/page.tsx', 'utf8');
const surfaces = [
  'src/app/positions/page.tsx',
  'src/app/allocation/page.tsx',
  'src/app/risk/page.tsx',
  'src/app/portfolio/page.tsx',
  'src/components/research-inbox.tsx',
  'src/app/ai-stock-discovery/page.tsx',
  'src/app/ai-insights/page.tsx',
].map((path) => readFileSync(path, 'utf8'));

describe('glass-green design system', () => {
  it('keeps glass-green colors scoped to dark mode', () => {
    expect(css).toMatch(/:root\[data-theme='dark'\][\s\S]*--accent: #14b8a6/);
    expect(css).toContain("[data-theme='dark'] .dashboard-hero");
    expect(css).toContain("[data-theme='dark'] .ambient-light");
  });

  it('renders decorative lights outside the content tree and hides them from assistive technology', () => {
    expect(shell.match(/className="ambient-light/g)).toHaveLength(2);
    expect(shell.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(shell.indexOf('className="ambient-light')).toBeLessThan(shell.indexOf('<Header />'));
  });

  it('provides reduced-motion and reduced-transparency alternatives', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(css).toContain('animation: none !important');
  });

  it('uses the dashboard hero across the supplied investment surfaces', () => {
    for (const surface of surfaces) expect(surface).toContain('dashboard-hero');
  });

  it('preserves the working allocation engine instead of the mock design endpoints', () => {
    expect(allocation).toContain('portfolioExposure');
    expect(allocation).toContain('PortfolioWeightPlanner');
    expect(allocation).not.toContain('/api/portfolio/selection');
    expect(allocation).not.toContain('/api/portfolio/${portfolioId}/allocation');
  });
});
