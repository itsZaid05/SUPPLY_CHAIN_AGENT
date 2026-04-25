import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./types/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          950: "#050816",
          900: "#09101f",
          800: "#111b2d",
          700: "#17253a",
        },
        accent: {
          300: "#66e2ff",
          400: "#3ec5ff",
          500: "#1499ff",
          600: "#0b67d0",
        },
        signal: {
          optimal: "#1ec88f",
          warning: "#f7b84a",
          critical: "#f45d5d",
        },
      },
      boxShadow: {
        warroom: "0 20px 60px rgba(2, 6, 23, 0.45)",
      },
      backgroundImage: {
        "mesh-grid":
          "radial-gradient(circle at top, rgba(20, 153, 255, 0.18), transparent 32%), radial-gradient(circle at bottom left, rgba(30, 200, 143, 0.12), transparent 28%), linear-gradient(rgba(102, 226, 255, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(102, 226, 255, 0.04) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "auto, auto, 32px 32px, 32px 32px",
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "'Segoe UI'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "'Consolas'", "'Courier New'", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
