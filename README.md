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

## Live GPU inference

The field map's **Connect GPU** and **Run on GPU** controls use the current single-image inference service. Start the service from the model repository and keep an SSH tunnel open:

```sh
ssh -L 8000:127.0.0.1:8000 <username>@<gpu-host>
```

The frontend calls `http://127.0.0.1:8000`. The mission processing replay and robot replay are sample data; they are not connected to DINOv3 batch processing or a live robot. The current live image result uses pixel coordinates unless a georeferencing transform is added.

The backend contract and Linux GPU service are in the `ag-group` model repository under `field_map_service/`.

## Box image import

The Image intake screen has an **Import from Box** picker. To activate it, serve the frontend over HTTP (not `file://`) and configure the Box app's read-only OAuth flow on a trusted backend. The frontend must never contain a Box client secret or a long-lived access token.

Set the same-origin endpoints in `box-config.js`:

- `tokenUrl`: returns `{ "access_token": "<short-lived read token>", "folder_id": "0" }`. The token must be allowed to browse/download the signed-in user's Box files.
- `downloadUrl`: accepts `?file_id=<Box file id>` and streams the file bytes after checking the signed-in user's authorization. The browser sends cookies with this request.

The picker is Box's Content Picker UI Element. It lists JPEG/PNG files, downloads the selected copies into the mission's current image batch, then runs the existing EXIF GPS check. The Box originals are unchanged. The Codex Box connection is separate from the app's runtime OAuth connection.

Register the app's frontend origin in Box's allowed CORS domains and have an administrator approve the Box platform app if the enterprise requires it. Keep OAuth client credentials and token refresh logic on the backend.


## Decision support views

The mission workspace includes a readiness checklist with direct links to intake, processing, review, and robot checks; a priority queue ranked by low confidence, correction status, and unknown ground-location accuracy; a per-weed evidence/history view; and a disagreement workspace for aerial/ground conflicts. Review decisions and original prediction values are retained in browser local storage.

The current model response does not include calibrated location uncertainty, overlap agreement, or crop-distance features. The map halos are labeled illustrative sample spreads. Replay and generated-position simulation are separate modes; Live is disabled until a robot heartbeat and camera service are connected. The history and disagreement examples are marked sample data and must be replaced by paired model/robot events for research reporting.
