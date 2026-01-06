import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig([
  globalIgnores(["**/dist"]),

  // node runtime
  {
    files: ["apps/main/**/*.ts", "packages/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        tsconfigRootDir: __dirname,
      },
    },
  },

  // browser runtime (renderer)
  // {
  //   files: ["apps/renderer/**/*.{ts,tsx}"],
  //   extends: [
  //     js.configs.recommended,
  //     ...tseslint.configs.recommended,
  //     reactHooks.configs.flat.recommended,
  //     reactRefresh.configs.vite,
  //   ],
  //   languageOptions: {
  //     ecmaVersion: 2020,
  //     globals: globals.browser,
  //     parserOptions: {
  //       tsconfigRootDir: __dirname,
  //     },
  //   },
  // },

  // preload
  {
    files: ["apps/preload/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        tsconfigRootDir: __dirname,
      },
    },
  },
]);
