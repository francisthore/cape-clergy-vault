// Server/tooling only. No routes import these options in Phase 2B.
export const authOptions = {
  emailAndPassword: { enabled: true, requireEmailVerification: true },
  session: { modelName: "sessions", cookieCache: { enabled: false } },
  user: { modelName: "users" },
  account: { modelName: "accounts" },
  verification: { modelName: "verifications" },
} as const;
