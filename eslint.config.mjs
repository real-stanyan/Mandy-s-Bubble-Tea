import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output / worktrees / throwaway — never source we maintain:
    "**/.next/**", // nested .next inside .claude worktrees
    ".claude/**", // agent worktrees + scratch
    "**/dist/**", // printer-client compiled JS
    "scripts/.tmp/**", // one-off diagnostic scripts
    "tmp/**",
    ".vercel/**",
    ".archviz/**",
  ]),

  // Test files: mock/fixture builders legitimately use `any`; typed doubles
  // add noise without safety. Runtime type-safety of tests is covered by the
  // tsc gate, not by lint. (Gate policy: see docs/adr/0011.)
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Node utility/diagnostic scripts run outside the Next bundle and use CommonJS
  // require + loose typing on purpose.
  {
    files: ["scripts/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // React-compiler-era advisory rules: real perf/style smells, but not
  // correctness. Kept visible as warnings so the gate blocks on genuine bugs
  // (rules-of-hooks, no-explicit-any in source, unused vars) without forcing a
  // component-effect refactor through unrelated PRs. (Gate policy: docs/adr/0011.)
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);

export default eslintConfig;
