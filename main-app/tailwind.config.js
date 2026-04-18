/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"DM Sans"',
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      boxShadow: {
        card:
          "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 4px 12px -2px rgb(15 23 42 / 0.08)",
        "card-lg":
          "0 4px 6px -1px rgb(15 23 42 / 0.06), 0 12px 24px -4px rgb(15 23 42 / 0.1)",
      },
    },
  },
  plugins: [],
};
