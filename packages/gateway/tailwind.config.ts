import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#0b0b0b',
        surface: {
          DEFAULT: '#121214',
          subtle: '#18181b',
          muted: '#202023',
        },
        border: {
          DEFAULT: '#27272a',
          subtle: '#1f1f23',
          strong: '#3f3f46',
        },
        brand: {
          DEFAULT: '#ff6600',
          hover: '#ff7a1a',
          subtle: 'rgba(255, 102, 0, 0.12)',
          border: 'rgba(255, 102, 0, 0.25)',
        },
        foreground: {
          DEFAULT: '#f4f4f5',
          muted: '#a1a1aa',
          dim: '#71717a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Geist Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
