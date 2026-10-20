/* Browser-to-local-machine inference bridge. The Vercel page never hosts the model. */
let gpuReady = false;
let serverHealth = null;
let liveRecords = [];
let liveImages = [];
let liveImageIndex = 0;
let currentRunId = null;
let confidenceCutoff = Number(localStorage.getItem("fieldwiseConfidenceCutoff")) || 70;

function applyLiveConfidenceCutoff() {
  if (!liveMode) return;
  const previousId = selected?.id;
  const visible = liveRecords.filter((weed) => weed.imageIndex === liveImageIndex && weed.status !== "Rejected");
  const pending = liveRecords.filter((weed) => weed.status === "Needs review");
  const belowCutoff = pending.length;
  const highConfidence = liveRecords.filter((weed) => weed.status === "High confidence").length;
  weeds.splice(0, weeds.length, ...visible);
  selected = visible.find((weed) => weed.id === previousId) || visible.find((weed) => weed.status === "Needs review") || visible[0] || null;

  document.getElementById("weedCount").textContent = String(liveRecords.filter((weed) => weed.status !== "Rejected").length);
  document.getElementById("weedMeta").textContent = `${belowCutoff} below ${confidenceCutoff}% · ${highConfidence} high confidence`;
  const reviewed = liveRecords.filter((weed) => weed.status === "Verified" || weed.status === "Rejected").length;
  document.getElementById("reviewedCount").textContent = String(reviewed);
  document.getElementById("reviewedMeta").textContent = `of ${liveRecords.length}`;
  document.getElementById("queueNum").textContent = String(pending.length);
  document.getElementById("targetCount").textContent = `${liveRecords.filter((weed) => weed.status === "Verified").length} / ${liveRecords.filter((weed) => weed.status !== "Rejected").length}`;
  const targetLabel = document.getElementById("targetLabel"); if (targetLabel) targetLabel.textContent = "Approved targets";
  document.getElementById("targetMeta").textContent = "locally approved · not sent";
  document.getElementById("cutoffSummary").textContent = `${pending.length} to review · ${highConfidence} high confidence`;

  if (selected) select(selected);
  else {
    draw();
    document.getElementById("weedTitle").textContent = "No detections in this image";
    document.getElementById("weedBadge").textContent = "CLEAR";
    document.getElementById("location").textContent = "No candidate locations";
    document.getElementById("conf").textContent = "—";
    document.getElementById("confbar").style.width = "0%";
    document.getElementById("detectionCrop").removeAttribute("src");
  }
}
function setConfidenceCutoff(value) {
  confidenceCutoff = Number(value);
  liveRecords.forEach((weed) => { if (weed.status === "Needs review" || weed.status === "High confidence") weed.status = weed.c < confidenceCutoff ? "Needs review" : "High confidence"; });
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

function updateImageNavigator() {
  let nav = document.getElementById("liveImageNavigator");
  if (!nav) {
    nav = document.createElement("div");
    nav.id = "liveImageNavigator";
    nav.className = "liveImageNavigator";
    nav.addEventListener("click", (event) => {
      const control = event.target.closest("[data-image-nav]");
      if (!control || control.disabled) return;
      if (control.dataset.imageNav === "previous") showLiveImage(liveImageIndex - 1);
      if (control.dataset.imageNav === "next") showLiveImage(liveImageIndex + 1);
      if (control.dataset.imageNav === "select") showLiveImage(Number(control.dataset.imageIndex));
    });
    document.querySelector(".mapfoot").before(nav);
  }
  nav.hidden = !liveMode || liveImages.length < 2;
  if (nav.hidden) return;
  nav.innerHTML = '<button type="button" data-image-nav="previous" aria-label="Previous image" ' + (liveImageIndex === 0 ? "disabled" : "") + '>‹</button><span>Image ' + (liveImageIndex + 1) + ' of ' + liveImages.length + '</span><div class="liveThumbs">' + liveImages.map((item, i) => '<button type="button" class="liveThumb ' + (i === liveImageIndex ? "active" : "") + '" data-image-nav="select" data-image-index="' + i + '" title="' + escapeHtml(item.file.name) + '"><img src="' + item.url + '" alt=""><small>' + (item.result ? "✓" : "!") + '</small></button>').join("") + '</div><button type="button" data-image-nav="next" aria-label="Next image" ' + (liveImageIndex === liveImages.length - 1 ? "disabled" : "") + '>›</button>';
}
function showLiveImage(index) {
  if (index < 0 || index >= liveImages.length) return;
  liveImageIndex = index;
  const item = liveImages[index];
  liveResult = item.result || null;
  liveImageMeta = { filename: item.result?.image?.filename || item.file.name, width: Number(item.result?.image?.width) || 1, height: Number(item.result?.image?.height) || 1 };
  liveImageFile = item.file;
  liveImageUrl = item.url;
  const image = document.getElementById("liveMapImage");
  image.onload = () => {
    if (!item.result) liveImageMeta = { filename: item.file.name, width: image.naturalWidth, height: image.naturalHeight };
    fitLiveLayers();
  };
  image.onerror = () => toast("This image could not be previewed in the browser.");
  image.src = item.url;
  document.getElementById("mapMeta").textContent = item.result
    ? `${liveImageMeta.filename} · ${liveImageMeta.width.toLocaleString()} × ${liveImageMeta.height.toLocaleString()} px`
    : `${item.file.name} · inference failed`;
  document.getElementById("mapFootLeft").innerHTML = item.error
    ? `<i class="online" style="background:#c76d5a"></i> Inference failed <span class="footsep">·</span> ${escapeHtml(item.error)}`
    : `<i class="online"></i> ${liveImages.filter(entry => entry.result).length} images processed <span class="footsep">·</span> viewing ${index + 1} of ${liveImages.length}`;
  document.querySelector(".legend").innerHTML = '<div class="leg"><i class="dot"></i>Needs review (&lt;70%)</div><div class="leg"><i class="dot green"></i>High confidence / verified</div>';
  updateImageNavigator();
  applyLiveConfidenceCutoff();
}

function applyBatchResults(results, failures, submittedFiles) {
  liveImages.forEach((item) => URL.revokeObjectURL(item.url));
  const succeeded = new Map(results.map((entry) => [entry.file, entry]));
  const failed = new Map(failures.map((entry) => [entry.file, entry]));
  liveImages = submittedFiles.map((file) => ({ ...succeeded.get(file), ...failed.get(file), file, url: URL.createObjectURL(file) }));
  liveImageIndex = 0;
  liveRecords = [];
  liveImages.forEach((item, imageIndex) => {
    if (!item.result) return;
    item.result.detections.forEach((detection, detectionIndex) => {
      const width = Math.max(1, Number(item.result.image?.width) || 1);
      const height = Math.max(1, Number(item.result.image?.height) || 1);
      const center = detection.center || {};
      const pixelCenter = detection.pixel_center || {};
      const px = Number.isFinite(Number(pixelCenter.x)) ? Number(pixelCenter.x) : Number.isFinite(Number(center.x)) ? Number(center.x) * width : width / 2;
      const py = Number.isFinite(Number(pixelCenter.y)) ? Number(pixelCenter.y) : Number.isFinite(Number(center.y)) ? Number(center.y) * height : height / 2;
      const rawConfidence = Number(detection.confidence);
      const confidence = Math.max(0, Math.min(100, Math.round(rawConfidence <= 1 ? rawConfidence * 100 : rawConfidence)));
      const rawBox = detection.bbox_px || {};
      const bbox = { x: Number.isFinite(Number(rawBox.x)) ? Number(rawBox.x) : Math.max(0, px - 40), y: Number.isFinite(Number(rawBox.y)) ? Number(rawBox.y) : Math.max(0, py - 40), width: Number.isFinite(Number(rawBox.width)) && Number(rawBox.width) > 0 ? Number(rawBox.width) : 80, height: Number.isFinite(Number(rawBox.height)) && Number(rawBox.height) > 0 ? Number(rawBox.height) : 80 };
      liveRecords.push({
        id: `W-${String(liveRecords.length + 1).padStart(4, "0")}`,
        sourceDetectionId: detection.id,
        label: detection.class_name || detection.label || "weed",
        x: Math.max(0, Math.min(100, Number.isFinite(Number(center.x)) ? Number(center.x) * 100 : px / width * 100)),
        y: Math.max(0, Math.min(100, Number.isFinite(Number(center.y)) ? Number(center.y) * 100 : py / height * 100)),
        c: confidence,
        status: detection.review_status === "Verified" ? "Verified" : detection.review_status === "Rejected" ? "Rejected" : confidence < confidenceCutoff ? "Needs review" : "High confidence",
        pixelX: px,
        pixelY: py,
        bbox,
        polygon: Array.isArray(detection.polygon) ? detection.polygon : [],
        imageIndex,
        detectionIndex,
        runId: item.runId,
      });
    });
  });
  liveMode = true;
  document.getElementById("mapstage").classList.add("liveMode");
  document.querySelector(".detail").classList.add("liveRecord");
  document.querySelector(".maplabel").innerHTML = "<i></i> PROCESSED FLIGHT IMAGES";
  document.querySelector(".sampletag").textContent = "LIVE MODEL";
  document.getElementById("robotLink").textContent = "Robot not connected to this prototype";
  document.getElementById("missionSummary").textContent = "Mission: survey review only";
  document.getElementById("visitedTargets").textContent = "No robot targets sent";
  document.getElementById("remainingTargets").textContent = "Awaiting georeferencing";
  document.getElementById("lastSync").textContent = "Inference just completed";
  document.getElementById("processedCount").textContent = String(results.length);
  document.getElementById("processedMeta").textContent = failures.length ? `${failures.length} failed · ${modelDeviceLabel(serverHealth?.device)}` : `${modelDeviceLabel(serverHealth?.device)} inference`;
  const cutoffBar = document.getElementById("confidenceCutoffBar");
  cutoffBar.hidden = false;
  document.getElementById("confidenceCutoff").value = String(confidenceCutoff);
  showLiveImage(0);
  if (liveRecords.length) {
    selected = liveRecords.find((weed) => weed.status === "Needs review") || liveRecords[0];
    if (selected.imageIndex !== liveImageIndex) showLiveImage(selected.imageIndex);
    select(selected);
  }
  window.fieldwiseBatchComplete?.({ images: results.length, submitted: submittedFiles.length, failed: failures.length, detections: liveRecords.length, belowCutoff: liveRecords.filter(weed => weed.status === "Needs review").length, cutoff: confidenceCutoff, model: serverHealth?.model || "Connected model" });
  toast(`${results.length} of ${submittedFiles.length} images processed · ${liveRecords.filter(weed => weed.status === "Needs review").length} candidates below ${confidenceCutoff}% need review.`);
}

function applyModelResult(result, file) {
  applyBatchResults([{ file, result }], [], [file]);
}

async function processOneImage(file) {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(`${gpuApi}/api/jobs`, { method: "POST", body: form });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `Upload failed (${response.status})`);
  }
  const job = await response.json();
  let completedJob;
  for (let attempt = 0; attempt < 1800; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const statusResponse = await fetch(`${gpuApi}/api/jobs/${job.id}`, { cache: "no-store" });
    if (!statusResponse.ok) throw new Error("Could not read inference job status.");
    completedJob = await statusResponse.json();
    if (completedJob.status === "completed" || completedJob.status === "failed") break;
  }
  if (!completedJob || completedJob.status !== "completed") throw new Error(completedJob?.error || "Inference timed out.");
  return completedJob.result;
}

async function submitImage(input) {
  const files = [...(input instanceof File ? [input] : Array.from(input || []))].filter(Boolean);
  if (!files.length) return;
  if (!serverHealth || !gpuReady) {
    const health = await connectGpu(false);
    if (!health || !gpuReady) {
      toast(health?.detail || "Start the local model service first.");
      return;
    }
  }
  const runButton = document.getElementById("runOnGpu");
  runButton.disabled = true;
  const results = [], failures = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    runButton.textContent = `${index + 1}/${files.length}…`;
    setGpuState("working", `Processing ${index + 1} of ${files.length} · ${file.name}`);
    document.getElementById("mapFootLeft").textContent = `Model inference · ${index + 1} of ${files.length} · ${file.name}`;
    try {
      const result = await processOneImage(file);
      if (!result.model && serverHealth?.model) result.model = serverHealth.model;
      results.push({ file, result });
      try { const savedRunId = await window.fieldwiseRunHistory?.saveRun(result, file, confidenceCutoff); if (savedRunId) results[results.length - 1].runId = savedRunId; }
      catch (saveError) { toast("Model completed, but saving failed: " + (saveError.message || "unknown error")); }
    } catch (error) {
      failures.push({ file, error: error.message || "Inference failed." });
    }
  }
  runButton.disabled = false;
  runButton.textContent = "Run model";
  document.getElementById("imageInput").value = "";
  setGpuState("connected", `Connected · ${modelDeviceLabel(serverHealth.device)}`);
  applyBatchResults(results, failures, files);
  if (failures.length) toast(`${failures.length} image(s) failed. They remain in the image navigator for inspection.`);
}

function restoreDemo() {
  liveMode = false;
  liveResult = null;
  liveImageMeta = null;
  liveImageFile = null;
  liveRecords = [];
  liveImages.forEach((item) => URL.revokeObjectURL(item.url));
  liveImages = [];
  liveImageIndex = 0;
  document.getElementById("liveImageNavigator")?.remove();
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
  const targetLabel = document.getElementById("targetLabel"); if (targetLabel) targetLabel.textContent = "Robot targets";
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
  if (!liveMode) return;
  const item = liveImages[liveImageIndex];
  if (!item?.result) return;
  item.result.detections = item.result.detections.map((detection, detectionIndex) => {
    const record = liveRecords.find((weed) => weed.imageIndex === liveImageIndex && weed.detectionIndex === detectionIndex);
    return { ...detection, review_status: record?.status || "Needs review" };
  });
  window.fieldwiseRunHistory?.syncReview(item.runId || currentRunId, item.result.detections);
}
document.getElementById("connectGpu").onclick = () => connectGpu(true);
document.getElementById("runOnGpu").onclick = async () => {
  if (!gpuReady) {
    const health = await connectGpu(true);
    if (!health || !gpuReady) return;
  }
  document.getElementById("imageInput").click();
};
document.getElementById("imageInput").onchange = (event) => submitImage(event.target.files);
document.getElementById("demoMode").onclick = restoreDemo;
document.getElementById("confidenceCutoff").value = String(confidenceCutoff);
document.getElementById("confidenceCutoff").onchange = (event) => setConfidenceCutoff(event.target.value);
window.fieldwiseRunLocalImage = submitImage;
window.fieldwiseSetCurrentRunId = (runId) => { currentRunId = runId; };
window.fieldwiseRestoreSavedRun = (result, file, runId) => {
  applyModelResult(result, file);
  currentRunId = runId;
  liveImages[0].runId = runId;
  liveRecords.forEach((weed) => { weed.runId = runId; });
  toast("Saved prediction run opened.");
};

document.getElementById("approveBtn").onclick = () => {
  if (!selected) return;
  const confirmed = selected;
  const confirmedId = selected.id;
  const wasLive = liveMode;
  selected.status = "Verified";
  if (wasLive) {
    persistLiveReview();
    const nextPending = liveRecords.find((weed) => weed.status === "Needs review");
    if (nextPending) {
      if (nextPending.imageIndex !== liveImageIndex) showLiveImage(nextPending.imageIndex);
      applyLiveConfidenceCutoff();
      select(nextPending);
      toast(`Detection ${confirmedId} confirmed · next low-confidence candidate selected.`);
    } else {
      applyLiveConfidenceCutoff();
      const same = liveRecords.find((weed) => weed.id === confirmedId);
      if (same) select(same);
      toast(`Detection ${confirmedId} confirmed · review queue complete.`);
    }
    return;
  }
  select(selected);
  document.getElementById("reviewedCount").textContent = String(Number(document.getElementById("reviewedCount").textContent) + 1);
  const currentIndex = weeds.indexOf(confirmed);
  const nextPending = [...weeds.slice(currentIndex + 1), ...weeds.slice(0, currentIndex)]
    .find((weed) => weed.status !== "Verified" && weed.status !== "Rejected");
  if (nextPending) {
    select(nextPending);
    toast(`Weed #${confirmedId} confirmed · next candidate selected.`);
  } else {
    select(confirmed);
    toast(`Weed #${confirmedId} confirmed · review queue complete.`);
  }
};

document.getElementById("rejectBtn").onclick = () => {
  if (!selected) return;
  if (liveMode) {
    selected.status = "Rejected";
    persistLiveReview();
    const nextPending = liveRecords.find((weed) => weed.status === "Needs review");
    if (nextPending && nextPending.imageIndex !== liveImageIndex) showLiveImage(nextPending.imageIndex);
    applyLiveConfidenceCutoff();
    if (nextPending) select(nextPending);
    toast("Candidate dismissed.");
    return;
  }
  weeds.splice(weeds.indexOf(selected), 1);
  document.getElementById("weedCount").textContent = String(Number(document.getElementById("weedCount").textContent) - 1);
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
