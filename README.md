# Fieldwise frontend

A static field operations demo for managing targeted weeding missions, reviewing aerial weed candidates, and inspecting robot outcomes.

## Run locally

Open `index.html` in a browser. Mission state and review corrections are stored in that browser's local storage.

The workspace includes:

- Mission list, create, and duplicate actions
- Image batch selection, EXIF GPS presence check, and an explicit note that camera GPS alone does not locate a weed on the ground
- A labeled sample processing replay and model provenance panel
- Weed review filters, map-linked candidate selection, confirm/reject/unsure/adjust actions, and target-list export
- A simulated robot route replay, labeled as not live
- Mission summary and downloadable target/results CSVs

## Run the model on your Mac

The Vercel site hosts the interface. The browser sends the selected image to a local inference service on the same Mac; Vercel does not receive the checkpoint. The field map's **Connect local model** and **Run model** controls use this service.

1. Download/unzip the model archive on your Mac and note the full path to its trained `.pt` checkpoint (often `best.pt`). Keep the checkpoint out of Git.
2. In Terminal, go to the local `ag-group` model repository and create the Mac Python environment:

   ```sh
   cd /Users/tanish/ag-group
   python3 -m venv .venv-macos
   source .venv-macos/bin/activate
   python -m pip install --upgrade pip
   python -m pip install -r field_map_service/requirements-macos.txt
   ```

3. In the same Terminal window, set the checkpoint path and start the local service. Replace `/full/path/to/best.pt` with the actual file path:

   ```sh
   export FIELDWISE_MODEL_PATH="/full/path/to/best.pt"
   export FIELDWISE_DEVICE=auto
   export FIELDWISE_ALLOWED_ORIGINS="https://frontendaghorseradish.vercel.app"
   python -m uvicorn field_map_service.app:app --host 127.0.0.1 --port 8000
   ```

   On Apple Silicon, `auto` selects Apple MPS when available and otherwise falls back to CPU. Keep this Terminal window open. The service stays bound to your Mac and is not exposed to the internet.

4. On that same Mac, open [Fieldwise](https://frontendaghorseradish.vercel.app) in Chrome. If Chrome asks whether the site can access devices on your local network, allow it.
5. Click **Connect local model**. Confirm the status reports the model and device (for example, `mps` or `cpu`).
6. Click **Run model**, choose a JPEG, PNG, or TIFF image, and review the detections. These are image pixel coordinates, not robot waypoints.

To check service/model status directly, open `http://127.0.0.1:8000/api/health` on the Mac. No SSH tunnel is needed when the browser and model service run on the same Mac. The Linux GPU SSH-tunnel workflow remains possible by starting the service on that host and forwarding port 8000.

The backend contract and inference service are in the `ag-group` model repository under `field_map_service/`.

## Box image import

The Image intake screen includes an **Import from Box** button, but Box import is currently **not active**: `box-config.js` has empty `tokenUrl` and `downloadUrl` values, and this static frontend repo has no Box OAuth backend. The picker displays this setup requirement instead of silently failing. To test real imagery now, choose local files in Image intake and click **Run first image locally**; this submits one selected image to the local model service. The frontend must never contain a Box client secret or a long-lived access token.

Set the same-origin endpoints in `box-config.js`:

- `tokenUrl`: returns `{ "access_token": "<short-lived read token>", "folder_id": "0" }`. The token must be allowed to browse/download the signed-in user's Box files.
- `downloadUrl`: accepts `?file_id=<Box file id>` and streams the file bytes after checking the signed-in user's authorization. The browser sends cookies with this request.

Once those endpoints and Box app settings are configured, the picker uses Box's Content Picker UI Element. It lists JPEG/PNG files, downloads selected copies into the mission's current image batch, then runs the existing EXIF GPS check. The Box originals remain unchanged. The Codex Box connection is separate from the app's runtime OAuth connection.

Register the app's frontend origin in Box's allowed CORS domains and have an administrator approve the Box platform app if the enterprise requires it. Keep OAuth client credentials and token refresh logic on the backend.


## Decision support views

The mission workspace includes a readiness checklist with direct links to intake, processing, review, and robot checks; a priority queue ranked by low confidence, correction status, and unknown ground-location accuracy; a per-weed evidence/history view; and a disagreement workspace for aerial/ground conflicts. Review decisions and original prediction values are retained in browser local storage.

The current model response does not include calibrated location uncertainty, overlap agreement, or crop-distance features. The map halos are labeled illustrative sample spreads. Replay and generated-position simulation are separate modes; Live is disabled until a robot heartbeat and camera service are connected. The history and disagreement examples are marked sample data and must be replaced by paired model/robot events for research reporting.
