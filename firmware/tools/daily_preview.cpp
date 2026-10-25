// Host preview of the 1.2.0 simple-mode daily pages using the firmware's own
// DailyDraw.h. Feed it /api/device/daily JSON as key=value env vars or use
// the built-in Oct 24 2026 sample:
//   g++ -O2 -I../include -I"<Adafruit GFX dir>" daily_preview.cpp -o /tmp/dyprev && /tmp/dyprev OUTDIR
// Writes <page>_<sub>.rgb (128x64 RGB888).
#include <stdio.h>
#include <stdlib.h>
#include "DailyDraw.h"

struct Canvas {
  uint8_t buf[64][128][3] = {};
  void px(int x, int y, uint8_t r, uint8_t g, uint8_t b) {
    if (x < 0 || x >= 128 || y < 0 || y >= 64) return;
    buf[y][x][0] = r; buf[y][x][1] = g; buf[y][x][2] = b;
  }
};
static const char *E(const char *k, const char *def) { const char *v = getenv(k); return v ? v : def; }

int main(int argc, char **argv) {
  const char *dir = argc > 1 ? argv[1] : ".";
  if (getenv("MOM")) g_momPal = true;   // Mom Wall palette
  DyData d{E("w", "orrery"), E("wp", "OR-er-ee"), E("ws", "noun"), E("wd", "a clockwork solar-system model"),
           E("wo", "after the Earl of Orrery"), E("wx", "The brass orrery showed the planets circling the Sun."),
           E("bn", "Kevin Kline"), E("bd", "American actor"), atoi(E("by", "1947")), atoi(E("age", "79")),
           E("cf", "Erik Satie's Gymnopedies were written in 1888."),
           E("ct", "Luciano Berio"), E("cx", "Italian composer"), E("ck", "composer_born"), atoi(E("cy", "1925")),
           E("mb", "10^2+24^2=26^2"), E("mt", "10/24/26: the last right-triangle date this century!"),
           E("fm", "Love you Mom! Dinner Sunday at 5."), E("ff", "Adam"),
           E("gt", "GEOGRAPHY"), E("gs", "Lake Baikal"), E("gx", "Russia's Lake Baikal is the deepest lake on Earth.")};
  const char *names[] = {"born", "word", "origin", "cfact", "ctoday", "math", "family", "earth"};
  for (int w = 0; w < 8; w++)
    for (int s = 0; s < dyPages(w, d); s++) {
      Canvas c; dyDraw(c, w, d, s);
      char p[256]; snprintf(p, sizeof(p), "%s/%s_%d.rgb", dir, names[w], s);
      FILE *f = fopen(p, "wb"); fwrite(c.buf, 1, sizeof(c.buf), f); fclose(f);
    }
  return 0;
}
