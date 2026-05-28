import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "third_party/**",
      "ai-worker/.venv/**",
      "ai-worker/storage/**",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
