import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

export default [
  {
    ignores: [
      ".next/**",
      "apps/*/dist/**",
      "apps/*/release/**",
      "data/**",
      "outputs/**",
      "report/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
]
