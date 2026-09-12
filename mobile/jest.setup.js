// Jest setup.
//
// The suites here cover pure logic (dates, currency, slot derivation, role
// helpers, validation schemas), so the native modules those units never touch
// are stubbed just enough to let the imports resolve.

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: '192.168.0.59:8081' } },
}));
