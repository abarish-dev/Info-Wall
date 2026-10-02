# Info-Wall firmware OTA files

Vercel serves everything in `backend/public/` from its CDN, so the panel
downloads new firmware from `<server>/fw/firmware.bin`. There is no upload
endpoint (the serverless filesystem is read-only); publishing is a commit +
redeploy.

`GET /api/firmware/latest?current=<ver>` reads `meta.json` from this folder and
returns `{version, size, available, update, url}`. It reports
`available: false` until `firmware.bin` exists here.

The first OTA-capable firmware (1.1.0) has to be flashed over USB once.
After that, the app's **Install update** button updates the panel over Wi-Fi.

## Publishing a new build

1. Bump `INFOWALL_FW_VERSION` in `firmware/include/Version.h` (e.g. `1.1.1`).
   The panel only installs a version strictly **higher** than the one it runs.
2. Build: `cd firmware && pio run`. Output:
   `firmware/.pio/build/adafruit_matrixportal_esp32s3/firmware.bin`.
3. Copy it here as `backend/public/fw/firmware.bin`.
4. Update `meta.json` so `version` matches Version.h exactly and `size` is the
   byte size of the .bin (`stat -c %s firmware.bin`):
   ```json
   { "version": "1.1.1", "size": 1700000 }
   ```
5. Commit both files and redeploy. Check
   `<server>/api/firmware/latest?current=1.1.0`: it should return
   `"available": true, "update": true, "url": "/fw/firmware.bin"`.
6. In the app, tap **Install update**. The panel shows `UPDATE v1.1.1`,
   downloads, flashes the other OTA slot and reboots.

To pull a bad build, delete `firmware.bin` (or roll back `meta.json`) and
redeploy.
