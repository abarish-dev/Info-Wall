// Bluetooth Low Energy service for the Smart LED Matrix.
//
// IMPORTANT: react-native-ble-plx is a NATIVE module. It only works in a
// development/production build — NOT in Expo Go or on web. We lazily require
// it and guard construction so the app still boots (and the whole UI works)
// in Expo Go / web; only the live BLE connect/sync is unavailable there.

import { Platform, PermissionsAndroid } from "react-native";
import { encode as base64Encode, decode as base64Decode } from "base-64";

export const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
export const CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

export type BleStatus =
  | "disconnected"
  | "scanning"
  | "connecting"
  | "connected";

// Lazily loaded native symbols.
let BleManagerCtor: any = null;
let bleLoadError = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BleManagerCtor = require("react-native-ble-plx").BleManager;
} catch {
  bleLoadError = true;
}

let manager: any = null;
function getManager(): any {
  if (bleLoadError || !BleManagerCtor) {
    throw new Error("BLE_UNAVAILABLE");
  }
  if (!manager) {
    manager = new BleManagerCtor();
  }
  return manager;
}

// True only when the native BLE module is actually present (real device build).
export function isBleSupported(): boolean {
  if (Platform.OS === "web") return false;
  if (bleLoadError || !BleManagerCtor) return false;
  try {
    getManager();
    return true;
  } catch {
    return false;
  }
}

async function requestAndroidPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const apiLevel = typeof Platform.Version === "number" ? Platform.Version : 31;
  try {
    if (apiLevel >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return (
        res["android.permission.BLUETOOTH_SCAN"] === "granted" &&
        res["android.permission.BLUETOOTH_CONNECT"] === "granted"
      );
    }
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

let connectedDevice: any = null;

export class BleError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Scan for a device advertising SERVICE_UUID, connect, and discover services.
 * onStatus reports scanning -> connecting -> connected transitions.
 */
export async function connectToMatrix(
  onStatus: (s: BleStatus) => void,
  onDisconnect?: () => void,
): Promise<{ id: string; name: string; rssi: number | null }> {
  if (!isBleSupported()) {
    throw new BleError(
      "BLE_UNAVAILABLE",
      "Bluetooth needs a real device build. It doesn't run in Expo Go or web preview.",
    );
  }

  const hasPerms = await requestAndroidPermissions();
  if (!hasPerms) {
    throw new BleError(
      "PERMISSION_DENIED",
      "Bluetooth permission was denied. Enable it in Settings to connect.",
    );
  }

  const bleManager = getManager();

  // Ensure the adapter is powered on.
  const state = await bleManager.state();
  if (state !== "PoweredOn") {
    throw new BleError(
      "BLUETOOTH_OFF",
      "Bluetooth is turned off. Please turn it on and try again.",
    );
  }

  onStatus("scanning");

  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      bleManager.stopDeviceScan();
      reject(
        new BleError(
          "NOT_FOUND",
          "No matrix found nearby. Make sure it's powered on and in range.",
        ),
      );
    }, 15000);

    bleManager.startDeviceScan(
      [SERVICE_UUID],
      null,
      async (error: any, device: any) => {
        if (settled) return;
        if (error) {
          settled = true;
          clearTimeout(timeout);
          bleManager.stopDeviceScan();
          reject(new BleError("SCAN_ERROR", error.message ?? "Scan failed."));
          return;
        }
        if (!device) return;

        settled = true;
        clearTimeout(timeout);
        bleManager.stopDeviceScan();
        onStatus("connecting");

        try {
          const d = await device.connect();
          await d.discoverAllServicesAndCharacteristics();
          connectedDevice = d;

          d.onDisconnected(() => {
            connectedDevice = null;
            onDisconnect?.();
          });

          let rssi: number | null = null;
          try {
            const withRssi = await d.readRSSI();
            rssi = withRssi?.rssi ?? null;
          } catch {
            rssi = null;
          }

          onStatus("connected");
          resolve({ id: d.id, name: d.name ?? "LED Matrix", rssi });
        } catch (e: any) {
          connectedDevice = null;
          reject(
            new BleError(
              "CONNECT_ERROR",
              e?.message ?? "Failed to connect to the matrix.",
            ),
          );
        }
      },
    );
  });
}

/**
 * Serialize the settings object to JSON, base64 encode it, and write it to the
 * characteristic. Falls back to write-without-response if needed.
 */
export async function syncSettings(
  payload: Record<string, unknown>,
): Promise<{ confirmed: boolean; readBack: unknown | null }> {
  if (!connectedDevice) {
    throw new BleError(
      "NOT_CONNECTED",
      "Not connected. Tap Connect to Matrix first.",
    );
  }

  const json = JSON.stringify(payload);
  // UTF-8 safe base64 encoding.
  const base64Value = base64Encode(unescape(encodeURIComponent(json)));

  try {
    await connectedDevice.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      base64Value,
    );
  } catch {
    await connectedDevice.writeCharacteristicWithoutResponseForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      base64Value,
    );
  }

  // Read the value back from the matrix to confirm it was applied.
  const readBack = await readSettings();
  const confirmed = readBack !== null;
  return { confirmed, readBack };
}

/** Read the characteristic value back and decode it. Returns null on any error. */
export async function readSettings(): Promise<unknown | null> {
  if (!connectedDevice) return null;
  try {
    const ch = await connectedDevice.readCharacteristicForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
    );
    if (!ch?.value) return null;
    const decoded = decodeURIComponent(escape(base64Decode(ch.value)));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/** Fire a one-off "flash test pattern" command to the matrix. */
export async function flashTest(): Promise<void> {
  if (!connectedDevice) {
    throw new BleError(
      "NOT_CONNECTED",
      "Not connected. Tap Connect to Matrix first.",
    );
  }
  const json = JSON.stringify({ command: "flash_test", ts: Date.now() });
  const value = base64Encode(unescape(encodeURIComponent(json)));
  try {
    await connectedDevice.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      value,
    );
  } catch {
    await connectedDevice.writeCharacteristicWithoutResponseForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      value,
    );
  }
}

/** Write a lightweight live command (no read-back) to the matrix. */
export async function writeLive(obj: Record<string, unknown>): Promise<void> {
  if (!connectedDevice) {
    throw new BleError("NOT_CONNECTED", "Not connected.");
  }
  const value = base64Encode(unescape(encodeURIComponent(JSON.stringify(obj))));
  try {
    await connectedDevice.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      value,
    );
  } catch {
    await connectedDevice.writeCharacteristicWithoutResponseForService(
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
      value,
    );
  }
}

/** Read current signal strength (RSSI, in dBm) of the connected device. */
export async function readRssi(): Promise<number | null> {
  if (!connectedDevice) return null;
  try {
    const d = await connectedDevice.readRSSI();
    return d?.rssi ?? null;
  } catch {
    return null;
  }
}

export async function disconnect(): Promise<void> {
  if (connectedDevice) {
    try {
      await connectedDevice.cancelConnection();
    } catch {
      // ignore
    }
    connectedDevice = null;
  }
}
