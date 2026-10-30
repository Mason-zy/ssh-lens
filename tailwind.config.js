/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /* Colour tokens resolve to CSS variables so the light/dark switch in
         styles.css takes effect without rebuilding. The `-rgb` variants exist
         because Tailwind's `/opacity` modifier needs raw channels. */
      colors: {
        ink: {
          950: 'rgb(var(--ink-950-rgb) / <alpha-value>)',
          900: 'rgb(var(--ink-900-rgb) / <alpha-value>)',
          850: 'rgb(var(--ink-850-rgb) / <alpha-value>)',
          800: 'rgb(var(--ink-800-rgb) / <alpha-value>)',
          700: 'rgb(var(--ink-700-rgb) / <alpha-value>)',
        },
        paper: {
          DEFAULT: 'rgb(var(--paper-rgb) / <alpha-value>)',
          dim: 'rgb(var(--paper-dim-rgb) / <alpha-value>)',
          faint: 'rgb(var(--paper-faint-rgb) / <alpha-value>)',
        },
        amber: {
          DEFAULT: 'rgb(var(--amber-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
