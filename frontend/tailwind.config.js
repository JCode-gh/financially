/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0d1117',
          100: '#161b22',
          200: '#21262d',
          300: '#2d333b',
          400: '#373e47'
        },
        accent: {
          DEFAULT: '#00d4ff',
          dim: '#0099cc'
        },
        bull: {
          DEFAULT: '#00ff88',
          dim: '#00cc6a'
        },
        bear: {
          DEFAULT: '#ff4444',
          dim: '#cc2222'
        },
        neutral: {
          DEFAULT: '#f0b429',
          dim: '#c78f1e'
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        ticker: 'ticker 30s linear infinite'
      },
      keyframes: {
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' }
        }
      }
    }
  },
  plugins: []
};
