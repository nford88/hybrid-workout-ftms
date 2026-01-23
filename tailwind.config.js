/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{html,js}",
    "./src/index.html",
    "./src/dev/**/*.html"
  ],
  theme: {
    extend: {
      // Custom breakpoints for better small window support
      screens: {
        'xs': '375px',
        // Default Tailwind breakpoints:
        // 'sm': '640px',
        // 'md': '768px',
        // 'lg': '1024px',
        // 'xl': '1280px',
        // '2xl': '1536px',
      },
      // Custom spacing for compact layouts
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      }
    },
  },
  plugins: [],
}
