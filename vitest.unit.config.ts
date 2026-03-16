import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/*.test.ts", "src/__tests__/*.test.tsx", "src/tests/*.test.ts", "src/tests/*.test.tsx"],
    exclude: ["src/__tests__/integration/**", "src/__tests__/e2e/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
