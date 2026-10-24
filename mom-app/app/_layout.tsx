import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { C, F } from "../src/theme";

export default function Layout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.bg },
          headerTintColor: C.text,
          headerTitleStyle: { fontSize: F.body, fontWeight: "700" },
          contentStyle: { backgroundColor: C.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Mom Wall" }} />
        <Stack.Screen name="today" options={{ title: "Today" }} />
        <Stack.Screen name="settings" options={{ title: "Wall Settings" }} />
        <Stack.Screen name="wifi" options={{ title: "Set Up Wi-Fi" }} />
      </Stack>
    </>
  );
}
