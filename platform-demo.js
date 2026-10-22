/* Live mission bridge: Linux mission API plus optional Mac inference. */
(() => {
  let server = sessionStorage.getItem("fieldwisePlatformUrl") || "http://127.0.0.1:8001";
  let mac = sessionStorage.getItem("fieldwiseMacUrl") || "http://127.0.0.1:8000";
  let token = "";
  let missionId = sessionStorage.getItem("fieldwisePlatformMission") || "";
  let processor = sessionStorage.getItem("fieldwisePlatformProcessor") || "linux";
  let missions = [], images = [], runs = [], detections = [], targets = [], observations = [], robots = [];
  let uploaded = [], currentIndex = 0, imageUrl = null, imageRequest = 0, connected = false, busy = false;
  let panel = null;

  const style = document.createElement("style");
  style.textContent = `.fp-setup{display:flex;flex-wrap:wrap;gap:8px;align-items:end}.fp-setup label{display:grid;gap:4px;color:#697567;font-size:11px}.fp-setup input,.fp-setup select,.fp-setup button,.fp-setup textarea{font:inherit}.fp-setup input,.fp-setup select{border:1px solid #dce3d8;background:#fff;border-radius:7px;padding:8px;min-width:150px}.fp-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.fp-line input{border:1px solid #dce3d8;border-radius:7px;padding:8px}.fp-items{display:grid;gap:7px}.fp-item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border:1px solid #e4e9e1;border-radius:7px;background:#fff}.fp-item small{color:#788474}.fp-image{position:relative;width:fit-content;max-width:100%;margin:auto}.fp-image img{display:block;max-width:100%;max-height:570px}.fp-image svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.fp-detection{border-top:1px solid #e4e9e1;padding:9px 0;display:flex;justify-content:space-between;align-items:center;gap:8px}.fp-detection small{display:block;color:#788474}.fp-badge{font-size:10px;padding:4px 7px;border-radius:20px;background:#e5f0e2;color:#355d3e}.fp-badge.warn{background:#fff0dc;color:#996119}.fp-muted{color:#748070}.fp-error{color:#a34537}.fp-status{min-height:19px}.fp-pre{white-space:pre-wrap;overflow-wrap:anywhere}`;
  document.head.append(style);

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
  const fmt = (date) => date ? new Date(date).toLocaleString() : "—";

  function localUrl(value) {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.username || parsed.password) {
      throw new Error("Use a local SSH tunnel URL such as http://127.0.0.1:8001.");
    }
    return parsed.origin;
  }

  async function api(path, options = {}, base = server) {
    const headers = new Headers(options.headers || {});
    if (base === server && token) headers.set("X-Fieldwise-Token", token);
    const response = await fetch(localUrl(base) + path, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `${response.status} ${response.statusText}`);
    return body;
  }

  function status(message, error = false) {
    const el = panel?.querySelector("#fpStatus");
    if (el) { el.textContent = message; el.className = `fp-status ${error ? "fp-error" : "fp-muted"}`; }
  }

  function shell() {
    if (!panel) return;
    panel.innerHTML = `<div class="mc-label">FIELDWISE · LIVE PLATFORM DEMO</div><h1 class="mc-h">Mission server</h1><div class="mc-sub">Keep Box as the source of the images. The Linux server saves this demo's runs, reviews, targets, and robot observations. Use an SSH tunnel from this laptop.</div>
      <div class="mc-card"><div class="fp-setup">
        <label>Linux mission API<input id="fpServer" value="${esc(server)}" spellcheck="false"></label>
        <label>Mac inference API<input id="fpMac" value="${esc(mac)}" spellcheck="false"></label>
        <label>Processing computer<select id="fpProcessor"><option value="linux" ${processor === "linux" ? "selected" : ""}>Linux · DINOv3/YOLO</option><option value="mac" ${processor === "mac" ? "selected" : ""}>This Mac · existing model</option></select></label>
        <label>Operator token, if configured<input id="fpToken" type="password" autocomplete="off" placeholder="Optional over local tunnel"></label>
        <button class="mc-btn primary" id="fpConnect">Connect</button>
      </div><p id="fpStatus" class="fp-status fp-muted">${connected ? "Connected to Linux mission server." : "Connect the Linux SSH tunnel, then click Connect."}</p></div>
      <div id="fpBody"></div>`;
    panel.querySelector("#fpToken").value = token;
    panel.querySelector("#fpConnect").onclick = connect;
    if (connected) renderBody();
  }

  async function connect() {
    try {
      server = localUrl(panel.querySelector("#fpServer").value.trim());
      mac = localUrl(panel.querySelector("#fpMac").value.trim());
      processor = panel.querySelector("#fpProcessor").value;
      token = panel.querySelector("#fpToken").value;
      sessionStorage.setItem("fieldwisePlatformUrl", server);
      sessionStorage.setItem("fieldwiseMacUrl", mac);
      sessionStorage.setItem("fieldwisePlatformProcessor", processor);
      const health = await api("/api/platform/health");
      if (health.service !== "fieldwise-platform") throw new Error("This URL is not the Fieldwise Linux mission API.");
      connected = true;
      await refresh();
      status(`Connected · ${health.engine} model ${health.model_ready ? "ready" : "unavailable"} · robot API ${health.robot_api_configured ? "configured" : "not configured"}`);
    } catch (error) {
      connected = false;
      status(`Connection failed: ${error.message}`, true);
    }
  }

  async function refresh() {
    missions = await api("/api/missions");
    if (!missions.some((item) => item.id === missionId)) missionId = missions[0]?.id || "";
    sessionStorage.setItem("fieldwisePlatformMission", missionId);
    if (missionId) {
      [images, runs, detections, targets, observations, robots] = await Promise.all([
        api(`/api/missions/${missionId}/images`), api(`/api/missions/${missionId}/runs`),
        api(`/api/missions/${missionId}/detections`), api(`/api/missions/${missionId}/targets`),
        api(`/api/missions/${missionId}/observations`), api("/api/robots"),
      ]);
    } else images = runs = detections = targets = observations = robots = [];
    currentIndex = Math.min(currentIndex, Math.max(0, images.length - 1));
    renderBody();
  }

  function renderBody() {
    const body = panel?.querySelector("#fpBody");
    if (!body) return;
    imageRequest += 1;
    const current = images[currentIndex];
    const selectedFiles = window.fieldwiseGetIntakeFiles?.() || [];
    body.innerHTML = `<div class="mc-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="mc-card"><div class="mc-label">IMAGES</div><div class="mc-stat">${images.length}</div><p>stored for this demo mission</p></div>
      <div class="mc-card"><div class="mc-label">DETECTIONS</div><div class="mc-stat">${detections.length}</div><p>model candidates across ${runs.length} run${runs.length === 1 ? "" : "s"}</p></div>
      <div class="mc-card"><div class="mc-label">APPROVED TARGETS</div><div class="mc-stat">${targets.length}</div><p>${targets.filter((target) => target.navigation_ready).length} with entered GPS coordinates</p></div></div>
      <div class="mc-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:12px">
        <div class="mc-card"><h3>Mission & intake</h3><div class="fp-line"><select id="fpMissionSelect" class="mc-btn" aria-label="Mission">${missions.map((mission) => `<option value="${esc(mission.id)}" ${mission.id === missionId ? "selected" : ""}>${esc(mission.name)}</option>`).join("")}</select><input id="fpMissionName" placeholder="New mission name" maxlength="120"><button class="mc-btn" id="fpCreate">Create</button></div>
          <p>${selectedFiles.length} image${selectedFiles.length === 1 ? "" : "s"} in Image intake. Box imports appear there after you pick them.</p>
          <div class="fp-line"><button class="mc-btn primary" id="fpUpload" ${!missionId || !selectedFiles.length || busy ? "disabled" : ""}>Copy intake batch to mission</button><button class="mc-btn" id="fpReload" ${busy ? "disabled" : ""}>Refresh</button></div>
          <p class="fp-muted">Original Box files remain in Box. This server keeps demo copies so saved results can reopen later.</p></div>
        <div class="mc-card"><h3>Processing</h3><p>Selected processor: <b>${processor === "mac" ? "Mac model at " + esc(mac) : "Linux model at " + esc(server)}</b></p>
          <button class="mc-btn primary" id="fpProcess" ${!missionId || !images.some((image) => image.status === "queued") || busy ? "disabled" : ""}>Process queued images</button>
          <div class="fp-items" style="margin-top:12px">${runs.slice(0, 5).map((run) => `<div class="fp-item"><span><b>Run ${esc(run.id.slice(0, 8))}</b><br><small>${esc(fmt(run.created_at))} · ${run.processed_count}/${run.image_count} images · ${run.detection_count} candidates</small></span><span class="fp-badge ${run.status === "failed" ? "warn" : ""}">${esc(run.status)}</span></div>`).join("") || '<p class="fp-muted">No processing runs yet.</p>'}</div></div></div>
      <div class="mc-grid" style="grid-template-columns:minmax(0,1.3fr) minmax(280px,.7fr);margin-top:12px">
        <div class="mc-card"><div class="mc-row"><h3>Processed images</h3><div class="fp-line"><button class="mc-btn" id="fpPrev" ${currentIndex <= 0 ? "disabled" : ""}>←</button><span>${images.length ? currentIndex + 1 : 0} of ${images.length}</span><button class="mc-btn" id="fpNext" ${currentIndex >= images.length - 1 ? "disabled" : ""}>→</button></div></div>
          <div class="fp-items">${images.map((image, index) => `<button class="fp-item" data-image-index="${index}" style="text-align:left;cursor:pointer;${index === currentIndex ? "border-color:#386849" : ""}"><span>${esc(image.filename)} <small>· ${esc(image.source_kind)}</small></span><span class="fp-badge ${image.status === "failed" ? "warn" : ""}">${esc(image.status)}</span></button>`).join("") || '<p class="fp-muted">Upload images from Image intake.</p>'}</div>
          <div id="fpViewer" style="margin-top:14px">${current ? "Loading image…" : ""}</div></div>
        <div class="mc-card"><h3>Review candidates</h3><div id="fpReview">Select a processed image.</div></div></div>
      <div class="mc-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:12px">
        <div class="mc-card"><h3>Approved target list</h3><p class="fp-muted">Image pixel positions are for review only. A target is navigation ready only after measured GPS coordinates are entered.</p><div class="fp-items">${targets.map((target) => `<div class="fp-item"><span><b>${esc(target.filename)}</b><br><small>${Math.round(target.center_x * 100)}%, ${Math.round(target.center_y * 100)}% in image</small></span><span class="fp-badge ${target.navigation_ready ? "" : "warn"}">${target.navigation_ready ? "GPS entered" : "Pixel only"}</span></div>`).join("") || '<p class="fp-muted">Confirm a candidate to create a test target.</p>'}</div></div>
        <div class="mc-card"><h3>Jetson observations</h3><div id="fpRobot">${robotHtml()}</div></div></div>`;
    body.querySelector("#fpMissionSelect").onchange = async (event) => {
      missionId = event.target.value; currentIndex = 0; uploaded = [];
      sessionStorage.setItem("fieldwisePlatformMission", missionId); await refresh();
    };
    body.querySelector("#fpCreate").onclick = createMission;
    body.querySelector("#fpUpload").onclick = uploadBatch;
    body.querySelector("#fpReload").onclick = () => refresh().catch((error) => status(error.message, true));
    body.querySelector("#fpProcess").onclick = processBatch;
    body.querySelector("#fpPrev").onclick = () => chooseImage(currentIndex - 1);
    body.querySelector("#fpNext").onclick = () => chooseImage(currentIndex + 1);
    body.querySelectorAll("[data-image-index]").forEach((button) => button.onclick = () => chooseImage(Number(button.dataset.imageIndex)));
    if (current) showImage(current).catch((error) => status(error.message, true));
  }

  function robotHtml() {
    return `<p>${robots.length ? robots.map((robot) => `<span class="fp-badge">${esc(robot.device_id)} · ${esc(robot.status)} · ${esc(fmt(robot.last_seen))}</span>`).join(" ") : "No robot heartbeat yet."}</p>
      <div class="fp-items">${observations.slice(0, 10).map((item) => `<div class="fp-item"><span><b>${esc(item.outcome)}</b> · ${esc(item.device_id)}<br><small>${esc(fmt(item.created_at))} · ${esc(item.note || "")}</small></span>${item.has_frame ? '<span class="fp-badge">camera frame saved</span>' : ""}</div>`).join("") || '<p class="fp-muted">No target observations yet.</p>'}</div>`;
  }

  async function createMission() {
    const name = panel.querySelector("#fpMissionName").value.trim();
    if (!name) { status("Enter a mission name.", true); return; }
    try {
      const mission = await api("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      missionId = mission.id; currentIndex = 0; uploaded = [];
      sessionStorage.setItem("fieldwisePlatformMission", missionId);
      await refresh(); status(`Created mission ${name}.`);
    } catch (error) { status(error.message, true); }
  }

  async function uploadBatch() {
    const files = window.fieldwiseGetIntakeFiles?.() || [];
    if (!files.length || !missionId) return;
    busy = true; uploaded = []; renderBody();
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        status(`Copying ${index + 1} of ${files.length}: ${file.name}`);
        const form = new FormData(); form.append("file", file, file.name);
        const headers = file.boxFileId ? { "X-Box-File-Id": file.boxFileId } : {};
        const image = await api(`/api/missions/${missionId}/images`, { method: "POST", headers, body: form });
        uploaded.push({ file, imageId: image.id });
      }
      await refresh(); status(`${uploaded.length} images copied to the mission.`);
    } catch (error) { status(`Upload stopped: ${error.message}`, true); await refresh().catch(() => {}); }
    finally { busy = false; renderBody(); }
  }

  async function processMac(file) {
    const form = new FormData(); form.append("file", file, file.name);
    const job = await api("/api/jobs", { method: "POST", body: form }, mac);
    for (let attempt = 0; attempt < 900; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const state = await api(`/api/jobs/${encodeURIComponent(job.id)}`, {}, mac);
      if (state.status === "completed") return state.result;
      if (state.status === "failed") throw new Error(state.error || "Mac model failed.");
    }
    throw new Error("Mac model did not finish within 22 minutes.");
  }

  async function processBatch() {
    if (!missionId || busy) return;
    busy = true; renderBody();
    try {
      if (processor === "linux") {
        const run = await api(`/api/missions/${missionId}/process`, { method: "POST" });
        for (let attempt = 0; attempt < 900; attempt += 1) {
          status(`Linux processing run ${run.id.slice(0, 8)} · checking progress…`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const list = await api(`/api/missions/${missionId}/runs`);
          const current = list.find((item) => item.id === run.id);
          if (current) status(`Linux processing ${current.processed_count}/${current.image_count} images · ${current.detection_count} candidates`);
          if (current && ["completed", "partial", "failed"].includes(current.status)) break;
        }
      } else {
        const queued = images.filter((image) => image.status === "queued");
        const batch = queued.map((image) => uploaded.find((entry) => entry.imageId === image.id));
        if (batch.some((entry) => !entry)) throw new Error("Mac processing needs the original browser files. Reopen Image intake and upload the batch again.");
        const results = [];
        for (let index = 0; index < batch.length; index += 1) {
          status(`Mac inference ${index + 1}/${batch.length} · ${batch[index].file.name}`);
          const result = await processMac(batch[index].file);
          results.push({ image_id: batch[index].imageId, result });
        }
        await api(`/api/missions/${missionId}/runs/import`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ results }),
        });
      }
      await refresh(); status(`Mission processing finished · ${detections.length} saved candidates.`);
    } catch (error) { status(`Processing failed: ${error.message}`, true); await refresh().catch(() => {}); }
    finally { busy = false; renderBody(); }
  }

  function chooseImage(index) {
    if (index < 0 || index >= images.length) return;
    currentIndex = index; renderBody();
  }

  async function showImage(image) {
    const requestId = imageRequest;
    const viewer = panel?.querySelector("#fpViewer");
    const review = panel?.querySelector("#fpReview");
    if (!viewer || !review) return;
    if (imageUrl) { URL.revokeObjectURL(imageUrl); imageUrl = null; }
    const imageDetections = detections.filter((item) => item.image_id === image.id);
    review.innerHTML = imageDetections.length ? imageDetections.map((item) => `<div class="fp-detection"><span><b>${esc(item.label)}</b> · ${Math.round(item.confidence * 100)}%<small>${esc(item.review_status)} · image ${Math.round(item.center_x * 100)}%, ${Math.round(item.center_y * 100)}%</small></span><span class="fp-line"><button class="mc-btn" data-review="${esc(item.id)}" data-status="approved">Confirm</button><button class="mc-btn" data-review="${esc(item.id)}" data-status="rejected">Dismiss</button></span></div>`).join("") : '<p class="fp-muted">No detections in this image.</p>';
    review.querySelectorAll("[data-review]").forEach((button) => button.onclick = () => reviewDetection(button.dataset.review, button.dataset.status));
    if (image.status !== "completed") { viewer.textContent = image.error || `Image status: ${image.status}`; return; }
    const response = await fetch(localUrl(server) + `/api/missions/${missionId}/images/${image.id}/file`, {
      headers: token ? { "X-Fieldwise-Token": token } : {},
    });
    if (!response.ok) throw new Error(`Could not load ${image.filename}: ${response.status}`);
    const blob = await response.blob();
    if (requestId !== imageRequest || panel?.querySelector("#fpViewer") !== viewer) return;
    imageUrl = URL.createObjectURL(blob);
    const polygons = imageDetections.map((item) => {
      const points = Array.isArray(item.polygon) ? item.polygon : [];
      if (points.length >= 3) return `<polygon points="${points.map((point) => `${Number(point[0]) * 100},${Number(point[1]) * 100}`).join(" ")}" fill="#e5a94b55" stroke="#f3bd62" stroke-width=".3"/>`;
      return `<circle cx="${Number(item.center_x) * 100}" cy="${Number(item.center_y) * 100}" r=".8" fill="#d98837" stroke="white" stroke-width=".2"/>`;
    }).join("");
    viewer.innerHTML = `<div class="fp-image"><img src="${imageUrl}" alt="${esc(image.filename)}"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${polygons}</svg></div><p class="fp-muted">${esc(image.filename)} · ${imageDetections.length} model candidates · positions shown in image coordinates.</p>`;
  }

  async function reviewDetection(id, decision) {
    try {
      await api(`/api/missions/${missionId}/detections/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ review_status: decision }),
      });
      await refresh(); status(decision === "approved" ? "Candidate approved as a test target." : "Candidate dismissed.");
    } catch (error) { status(error.message, true); }
  }

  window.fieldwisePlatformRender = (element) => { panel = element; shell(); };
  setInterval(async () => {
    if (!connected || !panel || !document.querySelector("#missionControl.open") || !panel.querySelector("#fpRobot") || !missionId) return;
    try {
      [robots, observations] = await Promise.all([
        api("/api/robots"), api(`/api/missions/${missionId}/observations`),
      ]);
      const robot = panel.querySelector("#fpRobot");
      if (robot) robot.innerHTML = robotHtml();
    } catch { /* Keep the last visible state; manual Refresh shows errors. */ }
  }, 5000);
})();
