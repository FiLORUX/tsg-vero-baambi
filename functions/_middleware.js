// Origin discipline for the vero-baambi Pages project.
//
// This project is served to the public by the tsg-proxy Worker under
// /tsg/vero-baambi on the apex; its own *.pages.dev hostname is an origin, never a
// surface. A request that reaches the origin name directly answers 308
// to the canonical path, path and query preserved, so no search engine
// indexes a duplicate. The proxy marks its own fetches with
// X-Thast-Proxy and is served as before; custom domains and preview
// deployments pass through untouched.
//
// Rule: one canonical, the rest redirect (thast.se doctrine §2.4). The
// origin list per surface lives in thast.se/internal/data/surfaces.json
// and the nightly loop asserts that no origin is ever indexable.
const PRODUCTION_ORIGIN = 'vero-baambi.pages.dev';
const CANONICAL = 'https://xn--thst-roa.se/tsg/vero-baambi';

export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.hostname === PRODUCTION_ORIGIN && !request.headers.get('x-thast-proxy')) {
    return Response.redirect(`${CANONICAL}${url.pathname}${url.search}`, 308);
  }
  return next();
};
