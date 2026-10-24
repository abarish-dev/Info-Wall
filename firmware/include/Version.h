// ===========================================================================
// Info Wall — Version.h
// Firmware version, reported to the app over BLE ({"fw":"x.y.z"}) and compared
// against the backend's /api/firmware/latest for over-the-air updates. The
// panel only installs a STRICTLY higher version, so bump this for every build
// you publish to backend/public/fw/ (see that folder's README).
// ===========================================================================
#pragma once
#define INFOWALL_FW_VERSION "1.2.15"
// Build-variant suffix shown on the boot screen only (not used for OTA).
#ifndef INFOWALL_FW_TAG
#define INFOWALL_FW_TAG ""
#endif

// Max TV shows the wall stores and shows (app MAX_SHOWS must match).
#define MAX_SHOWS 10
