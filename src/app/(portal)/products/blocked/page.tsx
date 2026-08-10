import { redirect } from 'next/navigation';

/**
 * Retired: Blocked / Rejected now lives as a tab on the consolidated Product
 * Sourcing page - see `products/pipeline/page.tsx`. Redirects rather than
 * 404s so an old bookmark or sidebar link still lands on the right tab.
 */
export default function BlockedRedirectPage() {
  redirect('/products/pipeline?tab=blocked');
}
