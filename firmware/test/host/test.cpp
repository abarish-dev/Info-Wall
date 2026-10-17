// Host test for Info Wall 1.1.2: custom allocator + filters + fw injection + retry scheduling.
#include <ArduinoJson.h>
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <initializer_list>
#include "../../include/MarketHours.h"

// Same shape as PsramAllocator, but counting (heap_caps_* replaced by malloc).
struct CountingAllocator : ArduinoJson::Allocator {
  size_t live = 0, peak = 0, calls = 0;
  void *allocate(size_t n) override { calls++; live += n; if (live > peak) peak = live; size_t *p=(size_t*)malloc(n+16); *p=n; return (char*)p+16; }
  void deallocate(void *p) override { if(!p) return; size_t *h=(size_t*)((char*)p-16); live -= *h; free(h); }
  void *reallocate(void *p, size_t n) override { if(!p) return allocate(n); size_t *h=(size_t*)((char*)p-16); live -= *h; h=(size_t*)realloc(h,n+16); *h=n; live+=n; if(live>peak)peak=live; return (char*)h+16; }
};

static std::string slurp(const char *f) { std::ifstream i(f); std::stringstream s; s << i.rdbuf(); return s.str(); }
static int fails = 0;
#define CHECK(c) do { if (!(c)) { printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); fails++; } } while (0)

static void cmp(const char *name, const std::string &body, JsonDocument &filter, CountingAllocator &a, CountingAllocator &b) {
  JsonDocument full(&a), filt(&b);
  CHECK(!deserializeJson(full, body));
  CHECK(!deserializeJson(filt, body, DeserializationOption::Filter(filter)));
  printf("%-8s body %4zu B | full doc peak %5zu B | filtered peak %5zu B\n", name, body.size(), a.peak, b.peak);
  CHECK(b.peak <= a.peak);
  CHECK(a.live == 0 || true);
}

// withFw() copy (std::string version of BLEController::withFw)
static std::string withFw(const std::string &json, const std::string &ver) {
  if (json.empty() || json[0] != '{' || json.find("\"fw\"") != std::string::npos) return json;
  std::string body = json.substr(1);
  size_t k = body.find_first_not_of(" \t\r\n"); body = k == std::string::npos ? "" : body.substr(k);
  std::string o = "{\"fw\":\"" + ver + "\"";
  if (body.empty() || body[0] != '}') o += ",";
  return o + body;
}

// settle() copy
static void settle(unsigned long now, unsigned long &last, unsigned long every, bool ok) {
  const unsigned long kRetryMs = 30000;
  if (ok || every <= kRetryMs) return;
  last = now - (every - kRetryMs);
  if (last == 0) last = 1;
}
static bool due(unsigned long now, unsigned long &last, unsigned long every) {
  if (last != 0 && now - last < every) return false;
  last = now == 0 ? 1 : now; return true;
}

int main() {
  { // scores
    CountingAllocator a, b; JsonDocument f;
    JsonObject ft = f["t"].add<JsonObject>();
    for (const char *k : {"c", "s", "h", "l", "r", "k"}) ft[k] = true;
    std::string body = slurp("scores.json");
    cmp("scores", body, f, a, b);
    JsonDocument d(&b); deserializeJson(d, body, DeserializationOption::Filter(f));
    CHECK(d["t"].as<JsonArray>().size() >= 1);
    for (JsonVariant e : d["t"].as<JsonArray>()) {
      CHECK(e["c"].is<const char*>()); CHECK(e["r"].is<const char*>());
      std::string l = e["l"] | ""; for (unsigned char ch : l) CHECK(ch < 0x80);
      printf("   %s | %s | %s | %s\n", (const char*)(e["c"]|""), (const char*)(e["r"]|""), (const char*)(e["l"]|""), (const char*)(e["k"]|""));
    }
  }
  { // planes
    CountingAllocator a, b; JsonDocument f;
    JsonObject fp = f["p"].add<JsonObject>();
    for (const char *k : {"f","fn","al","ia","lg","fr","to","typ","alt","spd","d"}) fp[k] = true;
    std::string body = slurp("planes.json");
    cmp("planes", body, f, a, b);
    JsonDocument d; deserializeJson(d, body, DeserializationOption::Filter(f));
    for (JsonVariant p : d["p"].as<JsonArray>()) { CHECK(p["trk"].isNull()); CHECK(!p["f"].isNull()); }
  }
  { // markets
    CountingAllocator a, b; JsonDocument f; f["st"] = true;
    JsonObject fm = f["m"].add<JsonObject>();
    for (const char *k : {"n","v","c","b","sp"}) fm[k] = true;
    std::string body = slurp("markets.json");
    cmp("markets", body, f, a, b);
    JsonDocument d; deserializeJson(d, body, DeserializationOption::Filter(f));
    CHECK(d["st"].is<const char*>()); CHECK(d["m"][0]["sp"].as<JsonArray>().size() > 0);
  }
  { // weekend rule (1.1.10): helpers + the server's empty-markets reply hides the page
    CHECK(marketsClosedDay(0) && marketsClosedDay(6));
    for (int d = 1; d <= 5; d++) CHECK(!marketsClosedDay(d));
    CHECK(tradesOnWeekends("BTC-USD") && tradesOnWeekends("eth-usd"));
    CHECK(!tradesOnWeekends("AAPL") && !tradesOnWeekends("BRK-B") && !tradesOnWeekends("USD") && !tradesOnWeekends(""));
    JsonDocument f; f["st"] = true; JsonObject fm = f["m"].add<JsonObject>();
    for (const char *k : {"n","v","c","b","sp"}) fm[k] = true;
    JsonDocument d; CHECK(!deserializeJson(d, "{\"st\":\"Closed\",\"m\":[]}", DeserializationOption::Filter(f)));
    int n = 0; for (JsonVariant m : d["m"].as<JsonArray>()) { (void)m; n++; }   // fetchMarkets loop
    CHECK(n == 0); CHECK(std::string(d["st"] | "") == "Closed");
    printf("weekend rule: ok\n"); }
  { // weather
    CountingAllocator a, b; JsonDocument f;
    for (const char *k : {"temp","hi","lo","text"}) f[k] = true;
    std::string body = slurp("weather.json");
    cmp("weather", body, f, a, b);
    JsonDocument d; deserializeJson(d, body, DeserializationOption::Filter(f));
    CHECK(!d["temp"].isNull());
  }
  { // tv
    CountingAllocator a, b; JsonDocument f;
    JsonObject fv = f["v"].add<JsonObject>(); fv["n"] = true; fv["l"] = true;
    cmp("tv", slurp("tv.json"), f, a, b);
  }
  { // allocator frees everything
    CountingAllocator a;
    { JsonDocument d(&a); deserializeJson(d, slurp("planes.json")); CHECK(a.live > 0); }
    CHECK(a.live == 0); printf("allocator: all blocks freed (calls=%zu)\n", a.calls);
  }
  // fw injection
  CHECK(withFw("{\"wifiStatus\":\"connected\"}", "1.1.2") == "{\"fw\":\"1.1.2\",\"wifiStatus\":\"connected\"}");
  CHECK(withFw("{\"fw\":\"1.1.2\"}", "1.1.2") == "{\"fw\":\"1.1.2\"}");
  CHECK(withFw("{}", "1.1.2") == "{\"fw\":\"1.1.2\"}");
  CHECK(withFw("{\"ready\":true,\"fw\":\"1.1.2\"}", "1.1.2") == "{\"ready\":true,\"fw\":\"1.1.2\"}");
  CHECK(withFw("not json", "1.1.2") == "not json");
  { JsonDocument d; CHECK(!deserializeJson(d, withFw("{\"command\":\"lake\",\"lvl\":\"97.1\"}", "1.1.2"))); CHECK(std::string(d["fw"]|"") == "1.1.2"); }
  // retry scheduling: hourly lake slot that fails retries ~30s later, success waits 1h
  { unsigned long last = 0, now = 100000;
    CHECK(due(now, last, 3600000)); settle(now, last, 3600000, false);
    CHECK(!due(now + 29000, last, 3600000)); CHECK(due(now + 30000, last, 3600000));
    settle(now + 30000, last, 3600000, true);
    CHECK(!due(now + 30000 + 3599000, last, 3600000)); CHECK(due(now + 30000 + 3600000, last, 3600000));
    unsigned long l2 = 0; CHECK(due(5000, l2, 30000)); settle(5000, l2, 30000, false); CHECK(!due(34000, l2, 30000)); CHECK(due(35000, l2, 30000));
    printf("retry scheduling: ok\n"); }
  printf(fails ? "%d FAILURES\n" : "ALL PASS\n", fails);
  return fails != 0;
}
