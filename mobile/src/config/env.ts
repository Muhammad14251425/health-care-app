/**
 * Environment configuration.
 *
 * The base URL differs per runtime and getting it wrong is the single most
 * common reason a working backend looks broken:
 *
 *   iOS simulator     http://localhost:8000        (shares the host loopback)
 *   Android emulator  http://10.0.2.2:8000         (10.0.2.2 IS the host loopback)
 *   Physical device   http://<host-lan-ip>:8000    (same Wi-Fi + firewall rule)
 *
 * Set EXPO_PUBLIC_API_URL in .env to override. When it is absent we fall back to
 * a per-platform default so the app runs out of the box on an emulator.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

function defaultBaseUrl(): string {
  if (Platform.OS === 'android') {
    // Android emulators alias the development machine's loopback to 10.0.2.2.
    // "localhost" inside the emulator is the emulator itself.
    return 'http://10.0.2.2:8000';
  }
  return 'http://localhost:8000';
}

/**
 * The LAN address of the machine running the packager.
 *
 * This is the case that matters when scanning the QR code with Expo Go: the
 * phone is a separate device, so "localhost" is the PHONE, and 10.0.2.2 (the
 * emulator's loopback alias) means nothing to it. The only address that can
 * work is the development machine's LAN IP -- which is exactly the host Expo
 * already used to serve the bundle, so we reuse it instead of asking anyone to
 * hand-edit .env whenever the network changes.
 */
function hostFromExpo(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Older manifest shape, still what Expo Go reports on some clients.
    Constants.manifest2?.extra?.expoClient?.hostUri;

  if (typeof hostUri !== 'string') return null;
  const host = hostUri.split(':')[0];
  // A loopback packager host means the bundle is being served to something on
  // this machine, so it tells us nothing about how to reach the LAN.
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return `http://${host}:8000`;
}

/** True when the bundle was served over the LAN, i.e. almost certainly a real device. */
export function isPhysicalDeviceSession(): boolean {
  return hostFromExpo() !== null;
}

/**
 * True for a host only an Android *emulator* can never reach.
 *
 * Inside the emulator, `localhost`/`127.0.0.1` is the emulator itself, and a
 * LAN address such as a laptop hotspot gateway (192.168.137.1) is not routed.
 * The host machine is reachable only via the 10.0.2.2 alias.
 */
function unreachableFromAndroidEmulator(url: string): boolean {
  if (Platform.OS !== 'android') return false;
  // A physical device DOES reach the LAN, and Expo tells us when we are on one.
  if (isPhysicalDeviceSession()) return false;

  const host = url.replace(/^https?:\/\//, '').split(':')[0] ?? '';
  if (host === 'localhost' || host === '127.0.0.1') return true;
  // Any private-range address: right for a real phone, wrong for an emulator.
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) && host !== '10.0.2.2';
}

function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) {
    const url = configured.replace(/\/+$/, '');
    // A pinned LAN/loopback address is correct for a phone but unroutable from
    // an emulator, where it surfaces as "No internet connection" on every
    // screen. Fall back rather than failing in a way that looks like a dead
    // backend; the override still wins everywhere it can actually work.
    if (unreachableFromAndroidEmulator(url)) {
      if (__DEV__) {
        console.warn(
          `[env] EXPO_PUBLIC_API_URL=${url} is not reachable from an Android ` +
            'emulator; using http://10.0.2.2:8000 instead. Set the variable to ' +
            'an emulator-reachable host to silence this.',
        );
      }
      return 'http://10.0.2.2:8000';
    }
    return url;
  }

  if (Platform.OS === 'android' || Platform.OS === 'ios') {
    const fromExpo = hostFromExpo();
    if (fromExpo) return fromExpo;
  }
  return defaultBaseUrl();
}

export const env = {
  apiBaseUrl: resolveBaseUrl(),
  /** Path prefix for every clinic_core endpoint. Note: all dots, no slashes. */
  apiPrefix: '/api/method/clinic_core.api.v1',
  requestTimeoutMs: 20_000,
  isDev: __DEV__,
} as const;

/**
 * Fail loudly at startup rather than at the first request, where a bad URL
 * surfaces as a confusing "Network request failed".
 */
export function validateEnv(): void {
  if (!/^https?:\/\/.+/.test(env.apiBaseUrl)) {
    throw new Error(
      `Invalid EXPO_PUBLIC_API_URL: "${env.apiBaseUrl}". ` +
        'Expected something like http://10.0.2.2:8000',
    );
  }
  if (!env.isDev && env.apiBaseUrl.startsWith('http://')) {
    // Cleartext is fine against a local dev bench; it is not fine shipping.
    console.warn(
      '[env] Using cleartext HTTP in a production build. ' +
        'Patient data must not travel unencrypted.',
    );
  }
}

export type Env = typeof env;
