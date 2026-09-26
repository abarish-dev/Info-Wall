// Small OpenStreetMap tile-grid map + polygon overlay/editor used by the
// control panel's map peek. Self-contained: uses inline styles + theme colors
// (which are read at render, so they follow the active accent).

import React, { useRef } from "react";
import { View, PanResponder } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@react-native-vector-icons/ionicons";
import Svg, { Polygon as SvgPolygon } from "react-native-svg";
import { colors, radius } from "@/src/theme";

export function signalColor(rssi: number | null): string {
  if (rssi == null) return colors.info;
  if (rssi >= -60) return colors.success;
  if (rssi >= -80) return colors.warning;
  return colors.error;
}

export function lonLatToTileFrac(lon: number, lat: number, z: number) {
  const n = Math.pow(2, z);
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

export function PolyOverlay({
  lat,
  lon,
  zoom,
  size,
  polygon,
}: {
  lat: number;
  lon: number;
  zoom: number;
  size: number;
  polygon: number[][];
}) {
  if (!polygon.length) return null;
  const z = zoom;
  const c = lonLatToTileFrac(lon, lat, z);
  const xt = Math.floor(c.x);
  const yt = Math.floor(c.y);
  const S = size / 3;
  const pts = polygon.map(([vlat, vlon]) => {
    const p = lonLatToTileFrac(vlon, vlat, z);
    return { x: (p.x - (xt - 1)) * S, y: (p.y - (yt - 1)) * S };
  });
  const pointsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <Svg
      width={size}
      height={size}
      style={{ position: "absolute", left: 0, top: 0 }}
      pointerEvents="none"
    >
      {pts.length >= 2 && (
        <SvgPolygon
          points={pointsStr}
          fill="rgba(255,107,0,0.22)"
          stroke={colors.brand}
          strokeWidth={2}
        />
      )}
    </Svg>
  );
}

function VertexHandle({
  x,
  y,
  index,
  onMove,
  toLatLon,
}: {
  x: number;
  y: number;
  index: number;
  onMove: (i: number, lat: number, lon: number) => void;
  toLatLon: (px: number, py: number) => { lat: number; lon: number };
}) {
  const posRef = useRef({ x, y });
  posRef.current = { x, y };
  const startRef = useRef({ x, y });
  const cbRef = useRef({ onMove, toLatLon });
  cbRef.current = { onMove, toLatLon };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = posRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const nx = startRef.current.x + g.dx;
        const ny = startRef.current.y + g.dy;
        const { lat, lon } = cbRef.current.toLatLon(nx, ny);
        cbRef.current.onMove(index, lat, lon);
      },
    }),
  ).current;

  return (
    <View
      testID={`poly-vertex-${index}`}
      {...pan.panHandlers}
      style={{
        position: "absolute",
        left: x - 16,
        top: y - 16,
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: colors.brand,
          borderWidth: 2,
          borderColor: colors.onSurface,
        }}
      />
    </View>
  );
}

export function PolyEditor({
  lat,
  lon,
  zoom,
  size,
  polygon,
  onMove,
}: {
  lat: number;
  lon: number;
  zoom: number;
  size: number;
  polygon: number[][];
  onMove: (i: number, lat: number, lon: number) => void;
}) {
  const z = zoom;
  const n = Math.pow(2, z);
  const c = lonLatToTileFrac(lon, lat, z);
  const xt = Math.floor(c.x);
  const yt = Math.floor(c.y);
  const S = size / 3;
  const toLatLon = (px: number, py: number) => {
    const tileX = xt - 1 + px / S;
    const tileY = yt - 1 + py / S;
    return {
      lon: (tileX / n) * 360 - 180,
      lat:
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * tileY) / n))) * 180) /
        Math.PI,
    };
  };
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, top: 0, width: size, height: size }}
    >
      {polygon.map(([vlat, vlon], i) => {
        const p = lonLatToTileFrac(vlon, vlat, z);
        const x = (p.x - (xt - 1)) * S;
        const y = (p.y - (yt - 1)) * S;
        return (
          <VertexHandle
            key={i}
            x={x}
            y={y}
            index={i}
            onMove={onMove}
            toLatLon={toLatLon}
          />
        );
      })}
    </View>
  );
}

export function TileMap({
  lat,
  lon,
  size,
  zoom,
  radiusMiles,
  mapType,
}: {
  lat: number;
  lon: number;
  size: number;
  zoom: number;
  radiusMiles?: number;
  mapType?: "streets" | "satellite";
}) {
  const z = zoom;
  const { x, y } = lonLatToTileFrac(lon, lat, z);
  const xt = Math.floor(x);
  const yt = Math.floor(y);
  const fracX = x - xt;
  const fracY = y - yt;
  const S = size / 3;

  const tileUrl = (tx: number, ty: number) =>
    mapType === "satellite"
      ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`
      : `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;

  const tiles: { i: number; j: number; uri: string }[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      tiles.push({ i, j, uri: tileUrl(xt - 1 + i, yt - 1 + j) });
    }
  }
  const markerLeft = S + fracX * S;
  const markerTop = S + fracY * S;

  // Radius circle: convert miles -> pixels at this zoom/latitude.
  const latRad = (lat * Math.PI) / 180;
  const metersPerPixel =
    (156543.03392 * Math.cos(latRad)) / Math.pow(2, z);
  const radiusPx =
    radiusMiles && metersPerPixel > 0
      ? (radiusMiles * 1609.34) / metersPerPixel
      : 0;

  return (
    <View
      testID="map-image"
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        overflow: "hidden",
        backgroundColor: colors.surfaceTertiary,
      }}
    >
      {tiles.map((t) => (
        <Image
          key={`${t.i}-${t.j}`}
          source={{ uri: t.uri }}
          style={{
            position: "absolute",
            left: t.i * S,
            top: t.j * S,
            width: S,
            height: S,
          }}
          contentFit="cover"
          transition={150}
        />
      ))}
      {radiusPx > 0 && (
        <View
          pointerEvents="none"
          testID="radius-overlay-circle"
          style={{
            position: "absolute",
            left: markerLeft - radiusPx,
            top: markerTop - radiusPx,
            width: radiusPx * 2,
            height: radiusPx * 2,
            borderRadius: radiusPx,
            backgroundColor: "rgba(255,107,0,0.22)",
            borderWidth: 2,
            borderColor: colors.brand,
          }}
        />
      )}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: markerLeft,
          top: markerTop,
          transform: [{ translateX: -14 }, { translateY: -26 }],
        }}
      >
        <Ionicons name="location" size={28} color={colors.brand} />
      </View>
    </View>
  );
}
