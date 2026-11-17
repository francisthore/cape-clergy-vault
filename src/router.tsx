import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { currentCspNonce } from "./lib/security/csp-context.server";
import { routeTree } from "./routeTree.gen";

// The server entry supplies a fresh value through request-local server context.
// Configure Router itself: a Start request-context field alone does not stamp scripts.
const getSsrOptions = createIsomorphicFn()
  .server(() => {
    const nonce = currentCspNonce();
    return nonce ? { nonce } : {};
  })
  .client(() => {
    const nonce = document.querySelector('meta[property="csp-nonce"]')?.getAttribute("content");
    return nonce ? { nonce } : {};
  });

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    ssr: getSsrOptions(),
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
