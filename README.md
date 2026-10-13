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
