import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { LogBox, StatusBar } from "react-native";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { ToastProvider } from "@/src/components/Toast";
import AnimatedSplash from "@/src/components/AnimatedSplash";
import { colors } from "@/src/theme";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

// Keep the native splash visible from cold start until our custom fonts
// register. @react-native-vector-icons loads its own icon font dynamically
// (via expo-font), so no separate icon-font gate is needed.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);
  const [fontsLoaded, fontsError] = useFonts({
    Rajdhani: require("../assets/fonts/Rajdhani-Regular.ttf"),
    "Rajdhani-Medium": require("../assets/fonts/Rajdhani-Medium.ttf"),
    IBMPlexSans: require("../assets/fonts/IBMPlexSans-Regular.ttf"),
    "IBMPlexSans-Medium": require("../assets/fonts/IBMPlexSans-Medium.ttf"),
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  const fontsReady = fontsLoaded || fontsError;

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ToastProvider>
            <StatusBar barStyle="light-content" backgroundColor={colors.surface} />
            <Stack screenOptions={{ headerShown: false }} />
            {!splashDone && (
              <AnimatedSplash onDone={() => setSplashDone(true)} />
            )}
          </ToastProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
