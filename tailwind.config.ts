import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
        score: {
          low: "#ef4444",
          mid: "#f59e0b",
          high: "#22c55e",
        },
        priority: {
          p0: "#dc2626",
          p1: "#f97316",
          p2: "#eab308",
          p3: "#6b7280",
        },
      },
    },
  },
  plugins: [],
};

export default config;
