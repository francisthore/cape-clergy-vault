import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { z } from "zod";

// Zod's optional JIT probes Function(), which strict CSP correctly rejects even
// when the library catches the exception. Configure before importing application
// schemas through StartClient, so validation uses the supported non-eval path.
z.config({ jitless: true });
void import("@tanstack/react-start/client").then(({ StartClient }) => {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>,
    );
  });
});
