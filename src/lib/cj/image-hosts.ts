/**
 * The CJdropshipping hosts allowed to serve product imagery.
 *
 * This lives in its own dependency-free module on purpose. Two very different
 * callers need it, and only one of them may pull Zod in:
 *
 * - server-side intake (`./primitives`, `./evidence`) validates an incoming
 *   address against this list before it is ever stored;
 * - `src/lib/images/cj-image-loader.ts` is the `next/image` loader, which Next
 *   serializes into the client bundle, so anything it imports ships to the
 *   browser.
 *
 * Keeping the list here means both read one source of truth without the loader
 * dragging Zod and the rest of `./primitives` into every page.
 *
 * `next.config.ts` `remotePatterns` must stay in step with this list.
 */
const CJ_IMAGE_HOSTS = ['cf.cjdropshipping.com', 'oss-cf.cjdropshipping.com'];

export default CJ_IMAGE_HOSTS;
