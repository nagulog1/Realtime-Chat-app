/** Tailwind config: colours and fonts for the whole app */
module.exports = {
  content: ['./public/**/*.html', './public/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        ink: '#1D1B18',          // warm off-black: text, my messages, primary buttons
        paper: '#F7F5F0',        // warm off-white: page background
        mist: '#EFECE5',         // slightly deeper paper: sidebar surface
        line: '#E3DED4',         // hairlines and borders
        signal: '#C4532F',       // the single accent: unread badges, links, focus
        'signal-dark': '#A8441F',
        live: '#4E8A5C',         // online status
        danger: '#B42318',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        body: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        // shadows tinted with the warm ink hue instead of pure black
        soft: '0 1px 2px rgba(56, 44, 28, 0.06), 0 4px 16px -6px rgba(56, 44, 28, 0.10)',
        lift: '0 2px 4px rgba(56, 44, 28, 0.05), 0 18px 40px -16px rgba(56, 44, 28, 0.22)',
      },
    },
  },
  plugins: [],
};
