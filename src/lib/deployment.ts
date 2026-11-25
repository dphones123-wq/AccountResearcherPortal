/**
 * Per-deployment settings. One portal deployment serves one seller's brain
 * (VITE_BRAIN, built in by deploy.yml from repo variables).
 *
 * Unset values fall back to the Figma deployment only when the brain is figma,
 * so another deployment can never silently inherit Figma's login domain or
 * Salesforce org: it gets no login domain (nobody can sign in) and no
 * Salesforce links until they are configured.
 */
export interface Deployment {
  brain: string;
  sellerName: string;
  allowedEmailDomains: string[];
  salesforceLightningHost: string | null;
}

const FIGMA = {
  sellerName: 'Figma',
  allowedEmailDomains: 'figma.com',
  salesforceLightningHost: 'https://figma.lightning.force.com',
};

export function parseDeployment(env: Record<string, string | boolean | undefined>): Deployment {
  const v = (k: string) => String(env[k] ?? '').trim();
  const brain = (v('VITE_BRAIN') || 'figma').toLowerCase();
  const fallback = brain === 'figma' ? FIGMA : null;
  const sellerName = v('VITE_SELLER_NAME') || fallback?.sellerName || brain.charAt(0).toUpperCase() + brain.slice(1);
  const allowedEmailDomains = (v('VITE_ALLOWED_EMAIL_DOMAINS') || fallback?.allowedEmailDomains || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  const salesforceLightningHost = v('VITE_SALESFORCE_LIGHTNING_HOST') || fallback?.salesforceLightningHost || null;
  return { brain, sellerName, allowedEmailDomains, salesforceLightningHost };
}

export const DEPLOYMENT = parseDeployment(import.meta.env);
export const SELLER = DEPLOYMENT.sellerName;

export function isAllowedEmail(email: string, d: Deployment = DEPLOYMENT): boolean {
  const at = email.lastIndexOf('@');
  return at > 0 && d.allowedEmailDomains.includes(email.slice(at + 1).trim().toLowerCase());
}
