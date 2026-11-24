/** @type {import('tailwindcss').Config} */
const c = (v) => `rgb(var(${v}) / <alpha-value>)`;
module.exports = {
  content: [__dirname + '/src/renderer/**/*.{ts,tsx,html}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        bg: c('--bg'),
        panel: c('--panel'),
        panel2: c('--panel2'),
        line: c('--line'),
        fg: c('--fg'),
        muted: c('--muted'),
        accent: c('--accent'),
        accent2: c('--accent2'),
        ok: c('--ok'),
        warn: c('--warn'),
        danger: c('--danger'),
      },
      fontFamily: { sans: ['"Segoe UI Variable"', '"Segoe UI"', 'Rubik', 'system-ui', 'sans-serif'] },
      boxShadow: { glow: '0 0 0 1px rgb(var(--accent) / 0.35), 0 10px 40px -10px rgb(var(--accent) / 0.45)' },
    },
  },
  plugins: [],
};
