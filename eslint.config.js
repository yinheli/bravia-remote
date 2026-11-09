import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "public/", "dist/", "vendor/", "bin/", "eslint.config.js"] },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs["recommended-latest"]],
  },
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    rules: {
      // Hard requirement for this project: no `any`, type unknown data with guards.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
