// ===========================================================================
// Info Wall — DeviceId.h  (1.2.22 simple / 1.3.1 main)
// Every HTTP request identifies the wall in its User-Agent:
//   InfoWall/1.2.22 (simple; id=3fa9c2)
// id = first 6 hex of an FNV-1a hash of the chip's factory MAC: stable per
// board, not reversible to the MAC, no Wi-Fi names or user data.
// ===========================================================================
#pragma once
#include <Arduino.h>
#include "Version.h"
#include "BLEController.h"

inline const char *iwDeviceId() {
  static char id[7] = {0};
  if (!id[0]) {
    uint64_t mac = ESP.getEfuseMac();
    uint32_t h = 2166136261u;
    for (int i = 0; i < 6; i++) { h ^= (uint8_t)(mac >> (8 * i)); h *= 16777619u; }
    snprintf(id, sizeof(id), "%06x", (unsigned)(h & 0xFFFFFF));
  }
  return id;
}
inline String iwUserAgent() {
  char ua[64];
  snprintf(ua, sizeof(ua), "InfoWall/%s (%s; id=%s)", INFOWALL_FW_VERSION,
           g_settings.simpleMode ? "simple" : "main", iwDeviceId());
  return String(ua);
}
