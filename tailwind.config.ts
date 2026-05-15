import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fdf5f7',
          100: '#f9e8ee',
          200: '#f1c9d8',
          300: '#e5a0bd',
          400: '#d4699a',
          500: '#bf3d76',
          600: '#a02057',
          700: '#6B1535',
          800: '#541029',
          900: '#3d0c1d',
        },
        gold: {
          light: '#e8d58a',
          DEFAULT: '#C8A84B',
          dark:  '#a8852c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        hebrew: ['Rubik', 'system-ui', 'sans-serif'],
        serif: ['Georgia', 'Cambria', '"Times New Roman"', 'Times', 'serif'],
      },
    },
  },
  plugins: [],
}

export default config
