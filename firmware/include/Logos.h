// ============================================================================
//  Logos.h — airline + team logo assets for the matrix.
//
//  Logos are pre-converted to 24x24 RGB565 bitmaps (uint16_t arrays) and blitted
//  with Display::drawLogo(). The actual pixel data + registry tables live in
//  the auto-generated `logos/generated_logos.h`.
//
//  ── Regenerating / adding logos ────────────────────────────────────────────
//    python3 tools/generate_logos.py
//  Edit the TEAMS / AIRLINES lists at the top of that script to add or change
//  entries (teams pull from ESPN's CDN, airlines from Google Flights logos).
//
//  If a lookup returns nullptr the display falls back to the text badge
//  (callsign / abbreviation), which always works.
// ============================================================================
#pragma once
#include <Arduino.h>

struct LogoAsset {
  const char*     key;    // "NFL:DAL" for teams, "AAL" (ICAO) for airlines
  const uint16_t* data;   // RGB565 pixels, row-major
  uint8_t         w;
  uint8_t         h;
};

// Pixel arrays + TEAM_LOGOS[] / AIRLINE_LOGOS[] tables (auto-generated).
#include "logos/generated_logos.h"

static const LogoAsset* findLogo(const LogoAsset* table, size_t n, const String& key) {
  for (size_t i = 0; i < n; i++)
    if (key.equalsIgnoreCase(table[i].key)) return &table[i];
  return nullptr;
}

inline const LogoAsset* teamLogo(const String& league, const String& abbr) {
  return findLogo(TEAM_LOGOS, sizeof(TEAM_LOGOS) / sizeof(LogoAsset),
                  league + ":" + abbr);
}

inline const LogoAsset* airlineLogo(const String& icao) {
  return findLogo(AIRLINE_LOGOS, sizeof(AIRLINE_LOGOS) / sizeof(LogoAsset), icao);
}
