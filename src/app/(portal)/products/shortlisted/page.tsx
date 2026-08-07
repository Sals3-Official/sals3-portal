import { redirect } from 'next/navigation';

/**
 * Retired: every "shortlisted" candidate now has an automated evaluation
 * status, shown across Qualified Products (Ready/Needs Attention),
 * Evaluating, and Blocked/Rejected instead of one generic list. This route
 * redirects rather than 404s so an old bookmark or link still lands
 * somewhere useful.
 *
 * TODO(cleanup): once file deletion is available in this environment,
 * delete this route entirely along with the other files noted in the
 * automated-evaluation-pipeline completion report.
 */
export default function ShortlistedRedirectPage() {
  redirect('/products/qualified/ready');
}
