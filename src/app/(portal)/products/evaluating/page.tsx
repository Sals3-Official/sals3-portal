import { redirect } from 'next/navigation';

/**
 * Retired: Evaluating now lives as a tab on the consolidated Product
 * Sourcing page - see `products/pipeline/page.tsx`. Redirects rather than
 * 404s so an old bookmark or sidebar link still lands on the right tab.
 */
export default function EvaluatingRedirectPage() {
  redirect('/products/pipeline?tab=evaluating');
}
