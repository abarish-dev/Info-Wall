// ===========================================================================
// Info Wall — Version.h
// Firmware version, reported to the app over BLE ({"fw":"x.y.z"}) and compared
// against the backend's /api/firmware/latest for over-the-air updates. The
// panel only installs a STRICTLY higher version, so bump this for every build
// you publish to backend/public/fw/ (see that folder's README).
// ===========================================================================
#pragma once
#define INFOWALL_FW_VERSION "1.1.0"
