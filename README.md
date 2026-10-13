# Fieldwise frontend

A static field operations demo for reviewing weed candidates on an aerial field map and connecting to the GPU inference service.

## Run locally

Open `index.html` in a browser. For live inference, run the service from the model repository and keep its SSH tunnel open:

```sh
ssh -L 8000:127.0.0.1:8000 <username>@<gpu-host>
```

The frontend calls `http://127.0.0.1:8000` for `/api/health` and image jobs. Until the GPU service is available, use the sample/demo mode.

The backend contract and Linux GPU service are currently in the `ag-group` model repository under `field_map_service/`.
