/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'form-grey': '#f3f4f6',
        'form-orange': '#f97316',
        brand: '#F47A1F',
        'app-bg': '#F6F7F9',
        surface: '#FFFFFF',
        'surface-subtle': '#FAFBFC',
        'app-border': '#D5DAE2',
        'app-border-strong': '#C7CDD6',
        'text-primary': '#101828',
        'text-secondary': '#475467',
        'text-muted': '#667085',
        'orange-soft': '#FFF5EE',
        'orange-border': '#F2D1BE',
        'icon-muted': '#B0B8C4',
      },
      borderRadius: {
        'card': '12px',
        'lg-card': '16px',
      },
      boxShadow: {
        'card': '0 1px 2px rgba(16, 24, 40, 0.05)',
        'card-lg': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
      },
    },
  },
  plugins: [],
}

