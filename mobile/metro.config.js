/**
 * Metro configuration for Expo SDK 54 + NativeWind v4.
 *
 * withNativeWind compiles global.css through Tailwind and feeds the resulting
 * atomic styles into the RN style system, so `className` works on native.
 */

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
