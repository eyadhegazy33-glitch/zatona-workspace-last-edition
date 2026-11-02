import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#202721",
        canvas: "#f6f7f5",
        brand: "rgb(var(--color-primary) / <alpha-value>)",
        brandSecondary: "rgb(var(--color-secondary) / <alpha-value>)",
      },
    },
  },
  plugins: [],
} satisfies Config;
