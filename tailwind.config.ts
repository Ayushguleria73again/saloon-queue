import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/features/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "var(--sf-bg-canvas)",
        dashboard: "var(--sf-bg-dashboard)",
        surface: "var(--sf-bg-surface)",
        muted: "var(--sf-bg-muted)",
        ink: {
          DEFAULT: "var(--sf-text-primary)",
          secondary: "var(--sf-text-secondary)",
        },
        subtle: "var(--sf-border-default)",
        brand: {
          primary: "var(--sf-brand-primary)",
          foreground: "var(--sf-brand-foreground)",
          accent: "var(--sf-brand-accent)",
        },
        status: {
          "waiting-bg": "var(--sf-status-waiting-bg)",
          "waiting-fg": "var(--sf-status-waiting-fg)",
          "called-bg": "var(--sf-status-called-bg)",
          "called-fg": "var(--sf-status-called-fg)",
          "inservice-bg": "var(--sf-status-inservice-bg)",
          "inservice-fg": "var(--sf-status-inservice-fg)",
          "completed-bg": "var(--sf-status-completed-bg)",
          "completed-fg": "var(--sf-status-completed-fg)",
          "skipped-bg": "var(--sf-status-skipped-bg)",
          "skipped-fg": "var(--sf-status-skipped-fg)",
          "cancelled-bg": "var(--sf-status-cancelled-bg)",
          "cancelled-fg": "var(--sf-status-cancelled-fg)",
          "noshow-bg": "var(--sf-status-noshow-bg)",
          "noshow-fg": "var(--sf-status-noshow-fg)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "var(--sf-radius-card)",
        control: "var(--sf-radius-control)",
      },
    },
  },
  plugins: [],
};

export default config;
