// ===========================================================================
// Info Wall — PsramJson.h
// ArduinoJson allocator that puts parsed JSON documents in PSRAM.
//
// Internal RAM is the panel's scarce resource: BLE, Wi-Fi, TLS (mbedTLS) and
// the HUB75 DMA buffers all need it. A JSON document parsed into internal
// heap right after a TLS handshake was failing with NoMemory while the phone
// was connected over BLE, so fetches silently stopped. We can NOT enable the
// global "big mallocs go to PSRAM" option (heap_caps_malloc_extmem_enable) —
// that starved the BLE controller — so only JSON documents opt in, here.
// Falls back to the normal heap if PSRAM is missing or full.
// ===========================================================================
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_heap_caps.h>

class PsramAllocator : public ArduinoJson::Allocator {
 public:
  void *allocate(size_t n) override {
    void *p = psramFound() ? heap_caps_malloc(n, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT) : nullptr;
    return p ? p : malloc(n);
  }
  void deallocate(void *p) override { free(p); }  // free() handles any heap_caps block
  void *reallocate(void *p, size_t n) override {
    if (psramFound()) {
      void *q = heap_caps_realloc(p, n, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
      if (q) return q;
    }
    return realloc(p, n);
  }
  static PsramAllocator *instance() {
    static PsramAllocator a;
    return &a;
  }
};

// A JsonDocument whose memory lives in PSRAM.
#define PSRAM_JSON(name) JsonDocument name(PsramAllocator::instance())
