# Mom Wall (simple mode) OTA channel

Served by `/api/firmware/latest?channel=simple`. Only simple-mode firmware
(1.2.6+) asks this channel; main-channel walls (1.1.x) never see it.

Publish (after Adam's OK): copy the app .bin here as `firmware.bin` and write
`meta.json` = {"version": "1.2.x", "size": <bytes>, "sha256": "<hex>"}, commit,
redeploy the backend. Nothing is published yet.
