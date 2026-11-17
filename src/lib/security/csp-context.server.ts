import { AsyncLocalStorage } from "node:async_hooks";
// Scoped to one render; never shared through a global value or a browser-supplied header.
const nonces = new AsyncLocalStorage<string | undefined>();
export const currentCspNonce = () => nonces.getStore();
export function withCspNonce<T>(nonce: string | undefined, work: () => T): T {
  return nonces.run(nonce, work);
}
