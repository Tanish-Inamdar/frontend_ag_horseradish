/* Browser-to-local-machine inference bridge. The Vercel page never hosts the model. */
let gpuReady = false;
let serverHealth = null;
let liveRecords = [];
let currentRunId = null;
let confidenceCutoff = Number(localStorage.getItem("fieldwiseConfidenceCutoff")) || 70;

function applyLiveConfidenceCutoff() {
  if (!liveMode) return;
  const previousId = selected?.id;
  const visible = liveRecords.filter((weed) => weed.c >= confidenceCutoff && weed.status !== "Rejected");
  weeds.splice(0, weeds.length, ...visible);
  const pending = visible.filter((weed) => weed.status !== "Verified");
  const belowCutoff = liveRecords.filter((weed) => weed.status !== "Rejected" && weed.c < confidenceCutoff).length;
  selected = visible.find((weed) => weed.id === previousId && weed.status !== "Verified") || pending[0] || visible.find((weed) => weed.id === previousId) || visible[0] || null;

  document.getElementById("weedCount").textContent = String(visible.length);
  document.getElementById("weedMeta").textContent = belowCutoff ? `${belowCutoff} below ${confidenceCutoff}% cutoff` : `≥${confidenceCutoff}% confidence`;
  document.getElementById("reviewedCount").textContent = String(visible.filter((weed) => weed.status === "Verified").length);
  document.getElementById("reviewedMeta").textContent = `of ${visible.length}`;
  document.getElementById("queueNum").textContent = String(pending.length);
  document.getElementById("targetCount").textContent = `${visible.filter((weed) => weed.status === "Verified").length} / ${visible.length}`;
  document.getElementById("targetMeta").textContent = "locally approved · not sent";
  document.getElementById("cutoffSummary").textContent = `${pending.length} to review · ${belowCutoff} below cutoff`;

  if (selected) {
    select(selected);
  } else {
    draw();
    document.getElementById("weedTitle").textContent = liveRecords.length ? "No detections meet cutoff" : "No weeds detected";
    document.getElementById("weedBadge").textContent = liveRecords.length ? "BELOW CUTOFF" : "CLEAR";
    document.getElementById("location").textContent = "No candidate locations";
    document.getElementById("conf").textContent = "—";
    document.getElementById("confbar").style.width = "0%";
    document.getElementById("detectionCrop").removeAttribute("src");
  }
}

function setConfidenceCutoff(value) {
  confidenceCutoff = Number(value);
  localStorage.setItem("fieldwiseConfidenceCutoff", String(confidenceCutoff));
  const control = document.getElementById("confidenceCutoff");
  if (control) control.value = String(confidenceCutoff);
  applyLiveConfidenceCutoff();
}

window.fieldwiseSetConfidenceCutoff = setConfidenceCutoff;

function modelDeviceLabel(device) {
  const normalized = String(device || "").toLowerCase();
  if (normalized.startsWith("mps")) return "Apple MPS";
  if (normalized.startsWith("cuda")) return "NVIDIA CUDA";
  if (normalized.startsWith("cpu")) return "CPU";
  return String(device || "unknown device");
}

function setGpuState(kind, label) {
  const state = document.getElementById("gpuState");
  state.className = `gpuState ${kind}`;
  state.replaceChildren(document.createElement("i"), document.createTextNode(` ${label}`));
}

async function connectGpu(showMessage = true) {
  setGpuState("working", "Checking GPU…");
  try {
    const response = await fetch(`${gpuApi}/api/health`, { cache: "no-store" });
    if (!response.ok) throw new Error(`GPU service returned ${response.status}`);
    serverHealth = await response.json();
    gpuReady = Boolean(serverHealth.model_ready);
    if (gpuReady) {
      setGpuState("connected", `Connected · ${modelDeviceLabel(serverHealth.device)}`);
      if (showMessage) toast(`Connected to ${serverHealth.model} · ${modelDeviceLabel(serverHealth.device)}`);
    } else if (serverHealth.model_ready) {
      setGpuState("error", "Model not loaded");
      if (showMessage) toast(serverHealth.detail || "The local model is not ready.");
    } else {
      setGpuState("error", "Model not ready");
      if (showMessage) toast(serverHealth.detail || "GPU service is online, but no model is loaded.");
    }
    return serverHealth;
  } catch {
    gpuReady = false;
    setGpuState("error", "GPU offline");
    if (showMessage) toast(`Cannot reach ${gpuApi}. Start the inference service on this Mac.`);
    return null;
  }
}

function fitLiveLayers() {
  if (!liveMode || !liveImageMeta) return;
  const stage = document.getElementById("mapstage");
  const stageWidth = stage.clientWidth;
  const stageHeight = stage.clientHeight;
  const scale = Math.min(stageWidth / liveImageMeta.width, stageHeight / liveImageMeta.height);
  const imageWidth = liveImageMeta.width * scale;
  const imageHeight = liveImageMeta.height * scale;
  const left = (stageWidth - imageWidth) / 2;
  const top = (stageHeight - imageHeight) / 2;
  for (const layer of [
    document.getElementById("liveMapImage"),
    markers,
    document.getElementById("maskOverlay"),
  ]) {
    Object.assign(layer.style, {
      left: `${left}px`, top: `${top}px`, width: `${imageWidth}px`, height: `${imageHeight}px`,
      right: "auto", bottom: "auto",
    });
  }
  draw();
  if (selected) drawCrop(selected);
}

function applyModelResult(result, file) {
  currentRunId = null;
  liveResult = result;
  if (!liveResult.model && serverHealth?.model) liveResult.model = serverHealth.model;
  liveImageMeta = result.image;
  liveImageFile = file;
  if (liveImageUrl) URL.revokeObjectURL(liveImageUrl);
  liveImageUrl = URL.createObjectURL(file);

  const image = document.getElementById("liveMapImage");
  image.onload = fitLiveLayers;
  image.onerror = () => toast("Model finished, but this browser cannot preview that image. Use JPEG or PNG.");
  image.src = liveImageUrl;
  liveMode = true;
  document.getElementById("mapstage").classList.add("liveMode");
  document.querySelector(".detail").classList.add("liveRecord");
  document.querySelector(".maplabel").innerHTML = "<i></i> UPLOADED IMAGE";
  document.querySelector(".sampletag").textContent = "LIVE MODEL";
  document.getElementById("mapMeta").textContent =
    `${result.image.filename} · ${result.image.width.toLocaleString()} × ${result.image.height.toLocaleString()} px`;
  document.getElementById("mapFootLeft").innerHTML =
    `<i class="online"></i> Local model inference complete <span class="footsep">·</span> ${result.tile_count} image tiles`;
  document.getElementById("mapFootRight").textContent =
    "Image pixel coordinates · georeferencing not attached";

  liveRecords = result.detections.map((d) => ({
    id: d.id,
    label: d.class_name,
    x: d.center.x * 100,
    y: d.center.y * 100,
    c: Math.round(d.confidence * 100),
    status: d.review_status || "Needs review",
    pixelX: d.pixel_center.x,
    pixelY: d.pixel_center.y,
    bbox: d.bbox_px,
    polygon: d.polygon,
  }));
  weeds.splice(0, weeds.length, ...liveRecords);
  selected = weeds[0] || null;

  document.getElementById("processedCount").textContent = "1";
  document.getElementById("processedMeta").textContent = `${modelDeviceLabel(result.device)} inference`;
  document.getElementById("reviewedCount").textContent = "0";
  document.getElementById("targetCount").textContent = "0 / 0";
  document.getElementById("targetMeta").textContent = "locally approved · not sent";
  document.getElementById("robotLink").textContent = "Robot not connected to this prototype";
  document.getElementById("missionSummary").textContent = "Mission: survey review only";
  document.getElementById("visitedTargets").textContent = "No robot targets sent";
  document.getElementById("remainingTargets").textContent = "Awaiting georeferencing";
  document.getElementById("lastSync").textContent = "Inference just completed";

  const cutoffBar = document.getElementById("confidenceCutoffBar");
  cutoffBar.hidden = false;
  document.getElementById("confidenceCutoff").value = String(confidenceCutoff);
  applyLiveConfidenceCutoff();
  toast(`${weeds.length} detections at or above ${confidenceCutoff}% confidence · ${liveRecords.length - weeds.length} below cutoff`);
}
async function submitImage(file) {
  if (!file) return;
  if (!serverHealth || !gpuReady) {
    const health = await connectGpu(false);
    if (!health || !gpuReady) {
      toast(health?.model_ready ? (health.detail || "The local model is not ready.") : (health?.detail || "Start the local model service first."));
      return;
    }
  }

  const runButton = document.getElementById("runOnGpu");
  runButton.disabled = true;
  runButton.textContent = "Uploading…";
  setGpuState("working", "Uploading image…");
  try {
    const form = new FormData();
    form.append("file", file, file.name);
    const response = await fetch(`${gpuApi}/api/jobs`, { method: "POST", body: form });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.detail || `Upload failed (${response.status})`);
    }
    const job = await response.json();
    setGpuState("working", "Model running…");
    runButton.textContent = "Processing…";

    let completedJob;
    for (let attempt = 0; attempt < 1800; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const statusResponse = await fetch(`${gpuApi}/api/jobs/${job.id}`, { cache: "no-store" });
      if (!statusResponse.ok) throw new Error("Could not read inference job status.");
      completedJob = await statusResponse.json();
      if (completedJob.status === "completed" || completedJob.status === "failed") break;
    }
    if (!completedJob || completedJob.status !== "completed") {
      throw new Error(completedJob?.error || "Inference timed out.");
    }
    setGpuState("connected", `Connected · ${modelDeviceLabel(serverHealth.device)}`);
    applyModelResult(completedJob.result, file);
    try {
      await window.fieldwiseRunHistory?.saveRun(completedJob.result, file, confidenceCutoff);
    } catch (saveError) {
      toast("Model finished, but saving the run failed: " + (saveError.message || "unknown error"));
    }
  } catch (error) {
    setGpuState("error", "GPU error");
    toast(error.message || "Model request failed.");
  } finally {
    runButton.disabled = false;
    runButton.textContent = "Run on GPU";
    document.getElementById("imageInput").value = "";
  }
}

function restoreDemo() {
  liveMode = false;
  liveResult = null;
  liveImageMeta = null;
  liveImageFile = null;
  liveRecords = [];
  document.getElementById("confidenceCutoffBar").hidden = true;
  if (liveImageUrl) URL.revokeObjectURL(liveImageUrl);
  liveImageUrl = null;
  const image = document.getElementById("liveMapImage");
  image.onload = null;
  image.removeAttribute("src");
  document.getElementById("mapstage").classList.remove("liveMode");
  document.querySelector(".detail").classList.remove("liveRecord");
  [image, markers, document.getElementById("maskOverlay")].forEach((layer) => layer.removeAttribute("style"));
  document.querySelector(".maplabel").innerHTML = "<i></i> NORTH BLOCK <span>12.4 ha</span>";
  document.querySelector(".sampletag").textContent = "DEMO DATA";
  document.getElementById("mapMeta").textContent = "20250710_stitched_300dpi.jpeg · Orthomosaic";
  document.getElementById("mapFootLeft").innerHTML =
    '<i class="online"></i> Imagery loaded <span class="footsep">·</span> 250 source images';
  document.getElementById("mapFootRight").innerHTML = "Illustrative demo map <b>ⓘ</b>";
  weeds.splice(0, weeds.length, ...demoWeeds.map((weed) => ({ ...weed })));
  selected = weeds[0];
  document.getElementById("processedCount").textContent = "250";
  document.getElementById("processedMeta").textContent = "↑ complete";
  document.getElementById("weedCount").textContent = "38";
  document.getElementById("weedMeta").textContent = "across 12.4 ha";
  document.getElementById("reviewedCount").textContent = "12";
  document.getElementById("reviewedMeta").textContent = "of 38";
  document.getElementById("queueNum").textContent = "26";
  document.getElementById("targetCount").textContent = "8 / 11";
  document.getElementById("targetMeta").textContent = "3 remaining";
  document.getElementById("robotLink").innerHTML = '<i class="online"></i>Robot connected';
  document.getElementById("missionSummary").innerHTML = "Mission: <b>Field 7 survey</b>";
  document.getElementById("visitedTargets").textContent = "8 targets visited";
  document.getElementById("remainingTargets").textContent = "3 remaining";
  document.getElementById("lastSync").textContent = "Last sync 2 min ago";
  setGpuState(gpuReady ? "connected" : "demo", gpuReady ? `Connected · ${modelDeviceLabel(serverHealth.device)}` : "Local model not connected");
  select(selected);
  toast("Sample field restored.");
}

function persistLiveReview() {
  if (!liveMode || !liveResult) return;
  const byId = new Map(liveRecords.map((weed) => [String(weed.id), weed.status]));
  liveResult.detections = liveResult.detections.map((detection) => ({
    ...detection,
    review_status: byId.get(String(detection.id)) || "Needs review",
  }));
  window.fieldwiseRunHistory?.syncReview(currentRunId, liveResult.detections);
}

document.getElementById("connectGpu").onclick = () => connectGpu(true);
document.getElementById("runOnGpu").onclick = async () => {
  if (!gpuReady) {
    const health = await connectGpu(true);
    if (!health || !gpuReady) return;
  }
  document.getElementById("imageInput").click();
};
document.getElementById("imageInput").onchange = (event) => submitImage(event.target.files[0]);
document.getElementById("demoMode").onclick = restoreDemo;
document.getElementById("confidenceCutoff").value = String(confidenceCutoff);
document.getElementById("confidenceCutoff").onchange = (event) => setConfidenceCutoff(event.target.value);
window.fieldwiseRunLocalImage = submitImage;
window.fieldwiseRestoreSavedRun = (result, file, runId) => {
  applyModelResult(result, file);
  currentRunId = runId;
  toast("Saved prediction run opened.");
};

document.getElementById("approveBtn").onclick = () => {
  if (!selected) return;
  const confirmed = selected;
  const confirmedId = selected.id;
  const currentIndex = weeds.indexOf(selected);
  const wasVerified = selected.status === "Verified";
  selected.status = "Verified";
  select(selected);
  persistLiveReview();
  if (liveMode) {
    const reviewed = Number(document.getElementById("reviewedCount").textContent) + (wasVerified ? 0 : 1);
    document.getElementById("reviewedCount").textContent = String(reviewed);
    document.getElementById("reviewedMeta").textContent = `of ${weeds.length}`;
    document.getElementById("targetCount").textContent = `${reviewed} / ${weeds.length}`;
    document.getElementById("targetMeta").textContent = "locally approved · not sent";
    document.getElementById("queueNum").textContent = String(weeds.filter((weed) => weed.status !== "Verified" && weed.status !== "Rejected").length);
  } else if (!wasVerified) {
    document.getElementById("reviewedCount").textContent = String(Number(document.getElementById("reviewedCount").textContent) + 1);
  }

  const nextPending = [
    ...weeds.slice(currentIndex + 1),
    ...weeds.slice(0, currentIndex),
  ].find((weed) => weed.status !== "Verified" && weed.status !== "Rejected");
  if (nextPending) {
    select(nextPending);
    toast(`${liveMode ? "Detection " : "Weed #"}${confirmedId} confirmed · next candidate selected.`);
  } else {
    select(confirmed);
    toast(`${liveMode ? "Detection " : "Weed #"}${confirmedId} confirmed · review queue complete.`);
  }
};

document.getElementById("rejectBtn").onclick = () => {
  if (!selected) return;
  if (liveMode) {
    selected.status = "Rejected";
    persistLiveReview();
    applyLiveConfidenceCutoff();
    toast("Candidate dismissed.");
    return;
  }
  weeds.splice(weeds.indexOf(selected), 1);
  document.getElementById("weedCount").textContent = String(liveMode ? weeds.length : Number(document.getElementById("weedCount").textContent) - 1);
  if (liveMode) {
    document.getElementById("reviewedMeta").textContent = `of ${weeds.length}`;
    document.getElementById("queueNum").textContent = String(weeds.length);
  }
  selected = weeds[0] || null;
  if (selected) select(selected);
  else {
    draw();
    document.getElementById("weedTitle").textContent = "No candidates remaining";
    document.getElementById("weedBadge").textContent = "REVIEWED";
    document.getElementById("conf").textContent = "—";
    document.getElementById("confbar").style.width = "0%";
  }
  toast("Candidate dismissed.");
};

window.addEventListener("resize", fitLiveLayers);
