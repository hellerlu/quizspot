/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.html",
    "./public/**/*.js"
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        "on-primary-fixed": "#001a41",
        "outline-variant": "#7e8597",
        "on-secondary": "#053900",
        "on-primary-container": "#00285b",
        "tertiary-fixed": "#e1e2eb",
        "surface-container-low": "#181c23",
        "primary-container": "#4a8eff",
        "primary-fixed": "#d8e2ff",
        "secondary-fixed": "#79ff5b",
        "on-tertiary-fixed": "#191c22",
        "inverse-on-surface": "#2d3039",
        "on-secondary-fixed-variant": "#095300",
        "background": "#10131b",
        "primary-fixed-dim": "#adc7ff",
        "primary": "#adc7ff",
        "tertiary-fixed-dim": "#c4c6cf",
        "surface": "#10131b",
        "surface-container-highest": "#31353d",
        "on-primary": "#002e68",
        "on-secondary-fixed": "#022100",
        "surface-bright": "#363942",
        "inverse-primary": "#005bc0",
        "on-primary-fixed-variant": "#004493",
        "outline": "#b2b7c6",
        "error-container": "#93000a",
        "secondary-container": "#2ff801",
        "surface-container": "#1c2027",
        "tertiary-container": "#8e9099",
        "surface-container-high": "#272a32",
        "on-error": "#690005",
        "surface-container-lowest": "#0b0e16",
        "on-tertiary-fixed-variant": "#44474e",
        "on-surface-variant": "#c1c6d7",
        "surface-dim": "#10131b",
        "tertiary": "#c4c6cf",
        "inverse-surface": "#e0e2ed",
        "secondary": "#d7ffc5",
        "on-background": "#e0e2ed",
        "on-secondary-container": "#0f6d00",
        "surface-variant": "#31353d",
        "on-error-container": "#ffdad6",
        "on-surface": "#e0e2ed",
        "on-tertiary-container": "#272a30",
        "secondary-fixed-dim": "#2ae500",
        "on-tertiary": "#2e3037",
        "surface-tint": "#adc7ff",
        "error": "#ffb4ab"
      },
      borderRadius: {
        "DEFAULT": "0.25rem",
        "lg": "0.5rem",
        "xl": "0.75rem",
        "full": "9999px"
      },
      spacing: {
        "base": "8px",
        "gutter-mobile": "16px",
        "xl": "80px",
        "sm": "12px",
        "safe-area-tv": "5%",
        "md": "24px",
        "xs": "4px",
        "lg": "48px"
      },
      fontFamily: {
        "display-tv": ["Sora", "sans-serif"],
        "body-md": ["Hanken Grotesk", "sans-serif"],
        "headline-md": ["Sora", "sans-serif"],
        "headline-lg-mobile": ["Sora", "sans-serif"],
        "headline-sm": ["Sora", "sans-serif"],
        "label-bold": ["Sora", "sans-serif"],
        "body-lg": ["Hanken Grotesk", "sans-serif"],
        "display-mobile": ["Sora", "sans-serif"],
        "headline-lg": ["Sora", "sans-serif"]
      },
      fontSize: {
        "display-tv": ["96px", { lineHeight: "110%", letterSpacing: "-0.02em", fontWeight: "800" }],
        "body-md": ["18px", { lineHeight: "150%", fontWeight: "400" }],
        "headline-md": ["48px", { lineHeight: "120%", fontWeight: "700" }],
        "headline-lg-mobile": ["28px", { lineHeight: "120%", fontWeight: "700" }],
        "headline-sm": ["32px", { lineHeight: "130%", fontWeight: "600" }],
        "label-bold": ["16px", { lineHeight: "100%", fontWeight: "700" }],
        "body-lg": ["24px", { lineHeight: "150%", fontWeight: "400" }],
        "display-mobile": ["40px", { lineHeight: "110%", fontWeight: "800" }],
        "headline-lg": ["64px", { lineHeight: "120%", fontWeight: "700" }]
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms')
  ]
};
