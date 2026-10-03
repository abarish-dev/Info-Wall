# Host test (no hardware)

Checks the 1.1.2 JSON changes on a PC: custom allocator frees everything,
the per-endpoint filters keep the fields the panel uses (and drop others),
the "fw" injection used for BLE reads, and the ~30s retry scheduling.
Fixtures are real responses from /api/device/* (captured 2026-10-03).

    g++ -std=c++17 -I ../../.pio/libdeps/<env>/ArduinoJson/src test.cpp -o t && ./t
