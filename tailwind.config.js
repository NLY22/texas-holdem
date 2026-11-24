/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        poker: {
          felt: '#1b5e20',
          feltDark: '#0d3810',
          border: '#3e2723',
          gold: '#ffd700',
          chipRed: '#d32f2f',
          chipBlue: '#1976d2',
          chipGreen: '#388e3c',
          chipBlack: '#212121',
        }
      },
      boxShadow: {
        'table': 'inset 0 0 80px rgba(0,0,0,0.8), 0 20px 40px rgba(0,0,0,0.6)',
        'chip': '0 4px 6px rgba(0,0,0,0.4), inset 0 2px 2px rgba(255,255,255,0.4)',
        'glow': '0 0 15px rgba(255, 215, 0, 0.6)'
      }
    },
  },
  plugins: [],
}
