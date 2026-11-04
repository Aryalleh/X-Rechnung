/** @type {import('tailwindcss').Config} */
// Palette: "Trust & Authority" (fintech/admin) from ui-ux-pro-max —
// navy ink primary, blue accent, slate neutrals. WCAG-AA contrast.
export default {
  content: ['./src/frontend/index.html', './src/frontend/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Primary = navy ink (buttons, headings)
        ink: {
          50: '#f1f5f9',
          100: '#e2e8f0',
          200: '#cbd5e1',
          600: '#334155',
          700: '#293548',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        // Accent = professional blue (links, focus, active)
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          500: '#0ea5e9',
          600: '#0369a1',
          700: '#075985',
        },
        accent: '#F2EA00', // invoice brand yellow (shared with PDF)
      },
      boxShadow: {
        card: '0 1px 2px rgba(2,6,23,0.04), 0 1px 3px rgba(2,6,23,0.06)',
      },
    },
  },
  plugins: [],
};
