import { redirect } from 'next/navigation';

/**
 * Retired: Ready now lives as a tab on the consolidated Product Sourcing
 * page (one window, not five routes) - see `products/pipeline/page.tsx`.
 * Redirects rather than 404s so an old bookmark or sidebar link still lands
 * on the right tab.
 */
export default function ReadyRedirectPage() {
  redirect('/products/pipeline?tab=ready');
}
