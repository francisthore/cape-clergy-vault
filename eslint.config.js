import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Generated, ignored or disposable output only. Tracked source is never listed here.
    // .local/ holds git-ignored private captures, disposable validation scripts and results.
    // types.ts is the generated historical Supabase schema type snapshot (read-only reference).
    ignores: [
      "dist",
      "dist-ssr",
      ".output",
      ".vinxi",
      ".nitro",
      ".tanstack",
      ".local",
      "playwright-report",
      "test-results",
      "src/integrations/supabase/types.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Justified, file-scoped exception: shadcn/ui primitives intentionally co-export variant
    // helpers with components. This only affects the dev fast-refresh hint, not security rules.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  eslintPluginPrettier,
);
