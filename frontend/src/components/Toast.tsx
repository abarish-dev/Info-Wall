// Custom toast (no default Alert). Mounted high in the tree so it floats above
// all content. Success/error variants with a Phosphor-style icon.

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { Animated, StyleSheet, Text, View, Easing } from "react-native";
import Ionicons, {
  type IoniconsIconName,
} from "@react-native-vector-icons/ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, radius, fonts, fontSize } from "@/src/theme";

type ToastVariant = "success" | "error" | "info";

type ToastContextValue = {
  show: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const VARIANT_META: Record<
  ToastVariant,
  { icon: IoniconsIconName; color: string }
> = {
  success: { icon: "checkmark-circle", color: colors.success },
  error: { icon: "alert-circle", color: colors.error },
  info: { icon: "information-circle", color: colors.info },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState("");
  const [variant, setVariant] = useState<ToastVariant>("success");
  const [mounted, setMounted] = useState(false);
  const translateY = useRef(new Animated.Value(120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 120,
        duration: 220,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => setMounted(false));
  }, [translateY, opacity]);

  const show = useCallback(
    (msg: string, v: ToastVariant = "success") => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setMessage(msg);
      setVariant(v);
      setMounted(true);
      translateY.setValue(120);
      opacity.setValue(0);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.back(1.2)),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
      hideTimer.current = setTimeout(hide, 2600);
    },
    [translateY, opacity, hide],
  );

  const meta = VARIANT_META[variant];

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {mounted && (
        <Animated.View
          testID="app-toast"
          style={[
            styles.wrap,
            {
              bottom: insets.bottom + spacing.xl,
              transform: [{ translateY }],
              opacity,
              pointerEvents: "none",
            },
          ]}
        >
          <View style={[styles.card, { borderLeftColor: meta.color }]}>
            <Ionicons name={meta.icon} size={22} color={meta.color} />
            <Text style={styles.text} numberOfLines={2}>
              {message}
            </Text>
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    alignItems: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    width: "100%",
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    flex: 1,
    color: colors.onSurface,
    fontFamily: fonts.text,
    fontSize: fontSize.base,
  },
});
