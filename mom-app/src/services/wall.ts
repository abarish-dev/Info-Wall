// Remembers the paired wall and gives screens a single "make sure we're
// connected" call. Uses the same BLE code as the main Info Wall app.
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  connectToKnownDevice, connectToMatrix, monitorMatrix, writeLive, BleError,
} from "./ble";

const KEY_DEV = "momwall.device";
const KEY_SET = "momwall.settings";
let connected = false;

export async function ensureConnected(): Promise<void> {
  if (connected) return;
  const known = await AsyncStorage.getItem(KEY_DEV);
  const onDrop = () => { connected = false; };
  let dev;
  try {
    dev = known
      ? await connectToKnownDevice(known, () => {}, onDrop)
      : await connectToMatrix(() => {}, onDrop);
  } catch (e) {
    if (!known || (e instanceof BleError && e.code === "BLE_UNAVAILABLE")) throw e;
    dev = await connectToMatrix(() => {}, onDrop);   // wall replaced / id changed
  }
  await AsyncStorage.setItem(KEY_DEV, dev.id);
  connected = true;
}

export async function send(obj: Record<string, unknown>): Promise<void> {
  await ensureConnected();
  await writeLive(obj);
}

export function listen(cb: (o: any) => void): void { monitorMatrix(cb); }

export type Toggles = {
  weather: boolean; moon: boolean; map: boolean; clock: boolean;
  planes: boolean; born: boolean; word: boolean;
  cfact: boolean; ctoday: boolean; math: boolean; family: boolean;
};
export const DEFAULT_TOGGLES: Toggles = {
  weather: true, moon: true, map: true, clock: true, planes: true,
  born: true, word: true, cfact: true, ctoday: true, math: true, family: true,
};

export async function loadToggles(): Promise<Toggles> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SET);
    return raw ? { ...DEFAULT_TOGGLES, ...JSON.parse(raw) } : DEFAULT_TOGGLES;
  } catch { return DEFAULT_TOGGLES; }
}

/** Push every toggle (simple mode on) — small commands, each fits one BLE frame. */
export async function applyToggles(t: Toggles): Promise<void> {
  await AsyncStorage.setItem(KEY_SET, JSON.stringify(t));
  await send({ command: "simple", simpleMode: true, planes: t.planes, tv: false, born: t.born,
    word: t.word, cfact: t.cfact, ctoday: t.ctoday, math: t.math, family: t.family });
  await send({ command: "weather", showWeather: t.weather, showForecast: t.weather, showMoon: t.moon });
  await send({ command: "sky", showMap: t.map, showIss: false, vipAlert: false });
  await send({ command: "clock", showBigClock: t.clock });
  await send({ command: "settime", epoch: Math.floor(Date.now() / 1000) });
}
