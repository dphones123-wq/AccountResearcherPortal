import { describe, it, expect } from 'vitest';
import { parseDeployment, isAllowedEmail } from './deployment';

describe('parseDeployment', () => {
  it('an unconfigured build is the Figma deployment', () => {
    expect(parseDeployment({})).toEqual({
      brain: 'figma',
      sellerName: 'Figma',
      allowedEmailDomains: ['figma.com'],
      salesforceLightningHost: 'https://figma.lightning.force.com',
    });
  });

  it('another brain never inherits Figma login or Salesforce settings', () => {
    const d = parseDeployment({ VITE_BRAIN: 'cognition' });
    expect(d).toEqual({ brain: 'cognition', sellerName: 'Cognition', allowedEmailDomains: [], salesforceLightningHost: null });
    expect(isAllowedEmail('a@figma.com', d)).toBe(false);
  });

  it('reads every setting from env', () => {
    const d = parseDeployment({
      VITE_BRAIN: 'cognition', VITE_SELLER_NAME: 'Cognition', VITE_ALLOWED_EMAIL_DOMAINS: 'cognition.ai, @windsurf.com',
      VITE_SALESFORCE_LIGHTNING_HOST: 'https://cognition.lightning.force.com',
    });
    expect(d.allowedEmailDomains).toEqual(['cognition.ai', 'windsurf.com']);
    expect(d.salesforceLightningHost).toBe('https://cognition.lightning.force.com');
    expect(isAllowedEmail('x@windsurf.com', d)).toBe(true);
    expect(isAllowedEmail('x@notwindsurf.com', d)).toBe(false);
    expect(isAllowedEmail('windsurf.com', d)).toBe(false);
  });
});
