// Host preview of the 1.1.17 sky pages, using the firmware's own SkyDraw.h
// and the Adafruit GFX 5x7 font. Build + run:
//   g++ -O2 -I../include -I"<Adafruit GFX dir>" sky_preview.cpp -o /tmp/skyprev && /tmp/skyprev OUTDIR
// Writes moon.rgb iss.rgb iss_now.rgb vip.rgb map.rgb (128x64 RGB888).
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#define PROGMEM
#include "glcdfont.c"
#include "SkyDraw.h"

struct Canvas {
  uint8_t buf[64][128][3] = {};
  void px(int x, int y, uint8_t r, uint8_t g, uint8_t b) {
    if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
    buf[y][x][0] = r; buf[y][x][1] = g; buf[y][x][2] = b;
  }
  void text(const char *s, int x, int y, uint8_t r, uint8_t g, uint8_t b) {
    for (; *s; s++, x += 6) {
      unsigned c = (uint8_t)*s;
      if (c >= 176) c++;   // Adafruit GFX classic-font quirk (_cp437 = false)
      for (int col = 0; col < 5; col++) {
        uint8_t bits = font[c * 5 + col];
        for (int row = 0; row < 8; row++) if (bits >> row & 1) px(x + col, y + row, r, g, b);
      }
    }
  }
  void save(const char *dir, const char *name) {
    char p[256]; snprintf(p, sizeof(p), "%s/%s", dir, name);
    FILE *f = fopen(p, "wb"); fwrite(buf, 1, sizeof(buf), f); fclose(f);
  }
};

int main(int argc, char **argv) {
  const char *dir = argc > 1 ? argv[1] : ".";
  // Values from the live /api/device/sky + sample VIP (argv[2..] optional JSON-free overrides kept simple).
  const char *ph = getenv("PH") ? getenv("PH") : "Waxing Gibbous";
  int il = getenv("IL") ? atoi(getenv("IL")) : 88;
  { Canvas c; SkyMoon m{il, true, ph, getenv("SR") ?: "7:35a", getenv("SS") ?: "6:38p", getenv("MR") ?: ""}; skyDrawMoon(c, m); c.save(dir, "moon.rgb"); }
  { Canvas c; SkyIss s{false, 263, "Thu Oct 29", "6:54a", "N", "E", 17, 5, "", "", 0}; skyDrawIss(c, s); c.save(dir, "iss.rgb"); }
  { Canvas c; SkyIss s{true, 263, "", "", "", "", 0, 0, "NW", "SE", 42}; skyDrawIss(c, s); c.save(dir, "iss_now.rgb"); }
  { Canvas c; SkyVip v{"AIR FORCE ONE", "VC-25A 82-8000", "SW", 12.3f, 23000, 1, 45, 410, true}; skyDrawVip(c, v); c.save(dir, "vip.rgb"); }
  { Canvas c; SkyVip v{"SPECIAL AIR MSN", "SAM44 C32", "NE", 38.0f, 9500, -1, 210, 320, false}; skyDrawVip(c, v); c.save(dir, "vip_sam.rgb"); }
  { Canvas c; skyDrawMap(c, time(nullptr), 35.58f, -80.81f, getenv("CLK") ?: ""); c.save(dir, "map.rgb"); }
  { time_t t = getenv("T") ? atol(getenv("T")) : time(nullptr); Canvas a, b; skyDrawMap(a, t, 35.58f, -80.81f, "1:10PM"); a.save(dir, "map_before.rgb"); skyDrawMap(b, t, 35.58f, -80.81f, "1:10PM", true); b.save(dir, "map_mom.rgb"); }
  return 0;
}
