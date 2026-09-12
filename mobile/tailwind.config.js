/**
 * Tailwind / NativeWind v4 configuration.
 *
 * The colour and radius scales mirror src/theme/* exactly. The theme files stay
 * the source of truth for anything consumed in TypeScript (StyleSheet, chart
 * colours, status tones); this file exposes the same tokens as utility classes
 * so ordinary layout can be written inline.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#F3F2ED',
        card: '#FFFFFF',
        line: '#EBE9E2',
        ink: '#10110F',
        muted: '#73756F',
        green: {
          DEFAULT: '#124F3D',
          secondary: '#1F6A53',
          action: '#285D4C',
        },
        gold: {
          DEFAULT: '#F4BF52',
          avatar: '#F2C65E',
        },
        peach: '#F8DDC7',
        mint: '#E8EFE7',
        paleYellow: '#F8ECC2',
        brown: '#965C33',
        danger: '#AD4F49',
        dangerSoft: '#FFF0EE',
        success: '#2D775F',
        successSoft: '#E3F0E8',
        warning: '#98721F',
        warningSoft: '#F3E0A4',
      },
      borderRadius: {
        tile: '14px',
        card: '16px',
        hero: '20px',
        nav: '20px',
      },
      fontFamily: {
        regular: ['Poppins_400Regular'],
        medium: ['Poppins_500Medium'],
        semibold: ['Poppins_600SemiBold'],
        bold: ['Poppins_700Bold'],
        extrabold: ['Poppins_800ExtraBold'],
      },
    },
  },
  plugins: [],
};
