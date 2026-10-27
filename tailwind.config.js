/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#14171c', 900: '#191d24', 850: '#1e232b', 800: '#20252e', 700: '#2a3039' },
        paper: { DEFAULT: '#e9e6df', dim: '#a8a49b', faint: '#6d6a63' },
        amber: { DEFAULT: '#c98a3c' },
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
