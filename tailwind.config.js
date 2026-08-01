/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/frontend/index.html', './src/frontend/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Vazirmatn is loaded locally (self-hosted) for the RTL Persian UI.
        sans: ['Vazirmatn', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
        },
      },
    },
  },
  plugins: [],
};
