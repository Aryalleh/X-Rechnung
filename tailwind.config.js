/** @type {import('tailwindcss').Config} */
// Design system (ui-ux-pro-max: "Flat Design" for SaaS/finance dashboards).
// All colors are semantic tokens defined as CSS variables in styles.css so
// light/dark themes swap in one place. Indigo primary, slate neutrals,
// WCAG-AA contrast in both themes.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./src/frontend/index.html', './src/frontend/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        line: token('border'),
        'line-strong': token('border-strong'),
        fg: token('text'),
        muted: token('muted'),
        primary: token('primary'),
        'primary-hover': token('primary-hover'),
        'primary-soft': token('primary-soft'),
        'primary-fg': token('primary-text'),
        'on-primary': token('on-primary'),
        success: token('success'),
        'success-soft': token('success-soft'),
        warning: token('warning'),
        'warning-soft': token('warning-soft'),
        danger: token('danger'),
        'danger-soft': token('danger-soft'),
        info: token('info'),
        'info-soft': token('info-soft'),
      },
      borderRadius: {
        xl: '0.875rem',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
};
