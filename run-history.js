/* Supabase-backed prediction history. RLS restricts records and images to the signed-in user. */
(() => {
  const bucket = "fieldwise-run-images";
  const maxImageBytes = 50 * 1024 * 1024;
  let client = null;
  let user = null;
  let overlay = null;
  let pending = [];
  let initialized = false;

  const css = ".fh-overlay{position:fixed;inset:0;background:#18221dcc;z-index:80;display:none;align-items:center;justify-content:center;padding:18px}.fh-overlay.open{display:flex}.fh-dialog{width:min(760px,100%);max-height:90vh;overflow:auto;background:#f7f8f5;border:1px solid #e3e8df;border-radius:14px;box-shadow:0 24px 80px #0005;color:#202a22}.fh-head{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid #e5e9e1;padding:15px 18px;display:flex;align-items:center;justify-content:space-between}.fh-head h2{margin:0;font-size:17px}.fh-close,.fh-btn{border:1px solid #dce2d8;background:#fff;border-radius:7px;padding:8px 11px;font:600 12px/1.4 Inter,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:#344236;cursor:pointer}.fh-btn.primary{background:#355f47;color:white;border-color:#355f47}.fh-body{padding:18px}.fh-auth{display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:520px}.fh-auth input{min-width:0;border:1px solid #dce2d8;border-radius:7px;padding:10px;font:13px/1.4 Inter,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}.fh-auth input:first-child{grid-column:span 2}.fh-status{font-size:12px;color:#667464;min-height:20px;margin:0 0 10px}.fh-user{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}.fh-list{display:grid;gap:8px}.fh-run{background:#fff;border:1px solid #e3e8df;border-radius:9px;padding:12px;display:flex;justify-content:space-between;gap:12px;align-items:center}.fh-run strong{display:block;font-size:12px;overflow-wrap:anywhere}.fh-run small{display:block;margin-top:4px;color:#788274;font-size:10px}.fh-empty{padding:18px;background:#fff;border:1px dashed #ccd5c8;border-radius:9px;color:#6c776a;font-size:12px}.fh-note{font-size:10px;line-height:1.5;color:#7a8578;margin-top:12px}@media(max-width:540px){.fh-auth{grid-template-columns:1fr}.fh-auth input:first-child{grid-column:auto}.fh-run{align-items:flex-start;flex-direction:column}.fh-run .fh-btn{width:100%}}";
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "fh-overlay";
    overlay.innerHTML = '<section class="fh-dialog" role="dialog" aria-modal="true" aria-labelledby="fhTitle"><header class="fh-head"><h2 id="fhTitle">Past prediction runs</h2><button class="fh-close" type="button">Close</button></header><div class="fh-body"><p class="fh-status" id="fhStatus" role="status">Connect to Supabase to load saved runs.</p><div id="fhContent"></div></div></section>';
    document.body.append(overlay);
    overlay.querySelector(".fh-close").onclick = close;
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
    return overlay;
  }

  function open() {
    ensureOverlay().classList.add("open");
    init().then(render).catch((error) => setStatus(error.message || "Could not connect to Supabase."));
  }
  function close() { overlay?.classList.remove("open"); }
  function setStatus(message) {
    const node = document.getElementById("fhStatus");
    if (node) node.textContent = message;
  }

  async function loadScript() {
    if (window.supabase?.createClient) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load the Supabase client library."));
      document.head.append(script);
    });
    if (!window.supabase?.createClient) throw new Error("Supabase client library did not initialize.");
  }

  async function init() {
    if (client) return client;
    const configResponse = await fetch("/api/supabase-config", { cache: "no-store" });
    const config = await configResponse.json().catch(() => ({}));
    if (!configResponse.ok) throw new Error(config.error || "Supabase configuration is missing.");
    await loadScript();
    client = window.supabase.createClient(config.url, config.anonKey);
    const { data } = await client.auth.getSession();
    user = data.session?.user || null;
    if (!initialized) {
      initialized = true;
      client.auth.onAuthStateChange((_event, session) => {
        user = session?.user || null;
        render();
        if (user && pending.length) flushPending();
      });
    }
    return client;
  }

  function render() {
    const content = document.getElementById("fhContent");
    if (!content) return;
    if (!client) {
      content.innerHTML = '<div class="fh-empty">Connecting…</div>';
      return;
    }
    if (!user) {
      content.innerHTML = '<div class="fh-auth"><input id="fhEmail" type="email" autocomplete="email" placeholder="Email address"><input id="fhPassword" type="password" autocomplete="current-password" placeholder="Password"><button class="fh-btn primary" id="fhSignIn" type="button">Sign in</button><button class="fh-btn" id="fhSignUp" type="button">Create account</button></div><p class="fh-note">Sign in before running the model to save results. Each account can see only its own runs. If email confirmation is enabled, check your inbox after creating an account.</p>';
      document.getElementById("fhSignIn").onclick = signIn;
      document.getElementById("fhSignUp").onclick = signUp;
      setStatus("Sign in or create an account to use saved runs.");
      return;
    }
    const email = escapeHtml(user.email || "Signed in");
    content.innerHTML = '<div class="fh-user"><span class="fh-note">Signed in as ' + email + '</span><button class="fh-btn" id="fhSignOut" type="button">Sign out</button></div><div class="fh-list" id="fhRuns"><div class="fh-empty">Loading saved runs…</div></div>';
    document.getElementById("fhSignOut").onclick = signOut;
    loadRuns();
  }

  function credentials() {
    const email = document.getElementById("fhEmail")?.value.trim();
    const password = document.getElementById("fhPassword")?.value;
    if (!email || !password) throw new Error("Enter your email and password.");
    return { email, password };
  }

  async function signIn() {
    try {
      await init();
      setStatus("Signing in…");
      const { email, password } = credentials();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      setStatus("Signed in. Loading your saved runs…");
      render();
    } catch (error) { setStatus(error.message || "Sign in failed."); }
  }

  async function signUp() {
    try {
      await init();
      setStatus("Creating your account…");
      const { email, password } = credentials();
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      if (data.session) {
        user = data.session.user;
        setStatus("Account created.");
        render();
        if (pending.length) flushPending();
      } else {
        setStatus("Account created. Confirm your email, then sign in here.");
      }
    } catch (error) { setStatus(error.message || "Account creation failed."); }
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) setStatus(error.message);
    else { user = null; render(); }
  }

  async function loadRuns() {
    const list = document.getElementById("fhRuns");
    if (!client || !user || !list) return;
    const { data, error } = await client.from("prediction_runs")
      .select("id,created_at,source_filename,model_name,device,image_width,image_height,tile_count,detection_count,confidence_cutoff,image_path,detections")
      .order("created_at", { ascending: false }).limit(50);
    if (error) {
      list.innerHTML = '<div class="fh-empty">Could not load runs: ' + escapeHtml(error.message) + '</div>';
      setStatus("Check that the saved-runs SQL setup completed successfully.");
      return;
    }
    if (!data.length) {
      list.innerHTML = '<div class="fh-empty">No saved runs yet. Sign in, run the model on an image, and it will appear here.</div>';
      setStatus("Your prediction history is ready.");
      return;
    }
    list.innerHTML = data.map((run) => {
      const date = new Date(run.created_at).toLocaleString();
      const source = run.image_path ? "image saved" : "results saved · source image not stored";
      const canOpen = Boolean(run.image_path);
      return '<article class="fh-run"><div><strong>' + escapeHtml(run.source_filename) + '</strong><small>' +
        escapeHtml(date) + ' · ' + escapeHtml(run.detection_count) + ' detections · ' +
        escapeHtml(run.device || "device unknown") + ' · ' + escapeHtml(source) +
        '</small></div><button class="fh-btn ' + (canOpen ? "primary" : "") + '" data-open-run="' +
        escapeHtml(run.id) + '" ' + (canOpen ? "" : "disabled") + '>' +
        (canOpen ? "Open run" : "No image") + '</button></article>';
    }).join("");
    list.querySelectorAll("[data-open-run]").forEach((button) => {
      if (!button.disabled) button.onclick = () => openRun(data.find((run) => run.id === button.dataset.openRun));
    });
    setStatus(data.length + " saved run" + (data.length === 1 ? "" : "s") + " · newest first.");
  }

  async function openRun(run) {
    if (!run || !client || !user) return;
    setStatus("Loading " + run.source_filename + "…");
    const { data: blob, error } = await client.storage.from(bucket).download(run.image_path);
    if (error) { setStatus("Could not load the saved image: " + error.message); return; }
    const file = new File([blob], run.source_filename, { type: blob.type || "image/jpeg" });
    const result = {
      id: run.id,
      filename: run.source_filename,
      model: run.model_name,
      device: run.device,
      tile_count: run.tile_count,
      image: { filename: run.source_filename, width: run.image_width, height: run.image_height },
      detections: run.detections || [],
    };
    close();
    if (typeof window.fieldwiseRestoreSavedRun !== "function") {
      setStatus("Refresh the field map, then open this run again.");
      return;
    }
    window.fieldwiseRestoreSavedRun(result, file, run.id);
  }

  async function persistRun(result, file, cutoff) {
    const sessionUser = user;
    if (!sessionUser) return false;
    const runId = crypto.randomUUID();
    let imagePath = null;
    if (file.size <= maxImageBytes) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      imagePath = sessionUser.id + "/" + runId + "/" + safeName;
      const { error: uploadError } = await client.storage.from(bucket).upload(imagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (uploadError) {
        imagePath = null;
        toast("Saving detections; image upload failed: " + uploadError.message);
      }
    } else {
      toast("Image is over the Supabase Free 50 MB limit; saving detections without the image.");
    }
    const detections = (result.detections || []).map((detection) => ({ ...detection }));
    const { error } = await client.from("prediction_runs").insert({
      id: runId,
      user_id: sessionUser.id,
      source_filename: file.name,
      model_name: result.model || window.fieldwiseModelName || null,
      device: result.device || null,
      image_width: result.image?.width || null,
      image_height: result.image?.height || null,
      tile_count: result.tile_count || 1,
      confidence_cutoff: cutoff,
      detection_count: detections.length,
      detections,
      image_path: imagePath,
      metadata: { saved_from: "local_model" },
    });
    if (error) {
      if (imagePath) await client.storage.from(bucket).remove([imagePath]);
      toast("Run was not saved: " + error.message);
      return false;
    }
    window.fieldwiseSetCurrentRunId?.(runId);
    toast("Prediction saved to Past runs.");
    return runId;
  }

  async function flushPending() {
    if (!user || !pending.length) return;
    const queued = pending.splice(0);
    for (const item of queued) await persistRun(item.result, item.file, item.cutoff);
  }

  async function saveRun(result, file, cutoff) {
    await init();
    if (!user) {
      pending.push({ result, file, cutoff });
      open();
      setStatus("Sign in to save this completed run. It is held in this page until saved.");
      return false;
    }
    return persistRun(result, file, cutoff);
  }

  async function syncReview(runId, detections) {
    if (!runId || !client || !user) return;
    const { error } = await client.from("prediction_runs")
      .update({ detections, detection_count: detections.length })
      .eq("id", runId).eq("user_id", user.id);
    if (error) toast("Review decision could not be saved: " + error.message);
  }

  window.fieldwiseRunHistory = { open, saveRun, syncReview };
  const historyButton = document.getElementById("historyNav");
  if (historyButton) historyButton.onclick = (event) => { event.preventDefault(); open(); };
})();
