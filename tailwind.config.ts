import type { Config } from 'tailwindcss';

/**
 * Tailwind is configured to consume the CSS custom properties defined in
 * `src/styles/tokens.css` rather than holding its own color literals.
 *
 * That indirection is deliberate: it means light/dark theming happens in exactly one file,
 * and no component can hard-code a hex value. `rgb(var(--x) / <alpha-value>)` keeps Tailwind's
 * opacity modifiers (`bg-surface/50`) working while the actual color stays in the token layer.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral surfaces (outside the 2-core + 1-accent budget per DESIGN.md)
        paper: 'rgb(var(--paper) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--surface-raised) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',

        // Core 1: ink
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-secondary': 'rgb(var(--ink-secondary) / <alpha-value>)',
        'ink-muted': 'rgb(var(--ink-muted) / <alpha-value>)',

        // Hairlines
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',

        // The one accent
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          soft: 'rgb(var(--accent-soft) / <alpha-value>)',
          fg: 'rgb(var(--accent-fg) / <alpha-value>)',
        },

        // Semantic status. Priority is never communicated by color alone; these are
        // always paired with a glyph and a label (see DESIGN.md).
        priority: {
          high: 'rgb(var(--priority-high) / <alpha-value>)',
          'high-soft': 'rgb(var(--priority-high-soft) / <alpha-value>)',
          medium: 'rgb(var(--priority-medium) / <alpha-value>)',
          'medium-soft': 'rgb(var(--priority-medium-soft) / <alpha-value>)',
          low: 'rgb(var(--priority-low) / <alpha-value>)',
          'low-soft': 'rgb(var(--priority-low-soft) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
          soft: 'rgb(var(--danger-soft) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--success) / <alpha-value>)',
          soft: 'rgb(var(--success-soft) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--warning) / <alpha-value>)',
          soft: 'rgb(var(--warning-soft) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        meta: ['0.75rem', { lineHeight: '1.125rem', fontWeight: '500' }],
        body: ['0.875rem', { lineHeight: '1.375rem' }],
        title: ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        display: ['1.875rem', { lineHeight: '2.25rem', fontWeight: '600', letterSpacing: '-0.02em' }],
        mono: ['0.8125rem', { lineHeight: '1.25rem' }],
      },
      borderRadius: {
        control: '6px',
        card: '8px',
        panel: '12px',
      },
      // Only two things in the product are genuinely elevated: the detail panel and
      // popovers. Everything else is flat paper with a hairline border (DESIGN.md).
      boxShadow: {
        panel: '0 1px 2px rgb(0 0 0 / 0.04), 0 8px 24px -8px rgb(0 0 0 / 0.12)',
        popover: '0 1px 2px rgb(0 0 0 / 0.05), 0 6px 16px -6px rgb(0 0 0 / 0.14)',
      },
      spacing: {
        sidebar: '15rem',
        'sidebar-collapsed': '4rem',
        'bottom-nav': '3.75rem',
      },
      transitionDuration: {
        // MOTION 1 (DESIGN.md): the complete permitted inventory.
        hover: '120ms',
        enter: '150ms',
        exit: '100ms',
      },
      keyframes: {
        'check-draw': {
          '0%': { strokeDashoffset: '24' },
          '100%': { strokeDashoffset: '0' },
        },
        'popover-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'sheet-in': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { opacity: '0.6' },
          '50%': { opacity: '1' },
          '100%': { opacity: '0.6' },
        },
      },
      animation: {
        'check-draw': 'check-draw 200ms ease-out forwards',
        'popover-in': 'popover-in 150ms ease-out',
        'sheet-in': 'sheet-in 150ms ease-out',
        shimmer: 'shimmer 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
