// ===========================================================================
// Info Wall — MarketHours.h
// Pure helpers (no Arduino deps, host-testable) for the weekend rule: US stock
// markets are closed all day Saturday and Sunday (US Eastern), so the stock
// slides ("MARKETS" tickers page and the S&P/Dow/Nasdaq indices page) sit out
// on those days instead of showing Friday's close as if it were live.
// ===========================================================================
#pragma once
#include <string.h>
#include <ctype.h>

// tm_wday: 0 = Sunday ... 6 = Saturday (struct tm, local = US Eastern).
inline bool marketsClosedDay(int tmWday) { return tmWday == 0 || tmWday == 6; }

// Crypto pairs (e.g. BTC-USD) trade 24/7, so a followed ticker like that keeps
// its slide on weekends. Everything else (equities/ETFs) is weekday-only.
inline bool tradesOnWeekends(const char *sym) {
  size_t n = sym ? strlen(sym) : 0;
  if (n < 5) return false;
  const char *t = sym + n - 4;
  return toupper((unsigned char)t[0]) == '-' && toupper((unsigned char)t[1]) == 'U' &&
         toupper((unsigned char)t[2]) == 'S' && toupper((unsigned char)t[3]) == 'D';
}
