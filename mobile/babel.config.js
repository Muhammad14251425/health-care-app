/**
 * Babel configuration for Expo SDK 54 + NativeWind v4 + Reanimated.
 *
 * Order matters: `react-native-worklets/plugin` (Reanimated 4's worklet plugin,
 * which replaced `react-native-reanimated/plugin`) must be LAST in the plugin
 * list, otherwise worklets are not transformed and animations fail at runtime.
 */

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: ['react-native-worklets/plugin'],
  };
};
