/* Box Content Picker adapter. No Box secrets or long-lived tokens are stored in this page. */
(() => {
  const config = window.FIELDWISE_BOX_CONFIG || {};
  const version = "27.0.0";
  let picker = null;
  let busy = false;
  let modal;
  const cssUrl = `https://cdn01.boxcdn.net/platform/elements/${version}/en-US/picker.css`;
  const jsUrl = `https://cdn01.boxcdn.net/platform/elements/${version}/en-US/picker.js`;

  const ensureModal = () => {
    if (modal) return modal;
    const style = document.createElement("style");
    style.textContent = `.box-import-overlay{position:fixed;inset:0;z-index:60;background:#1b241bcc;display:none;align-items:center;justify-content:center;padding:20px}.box-import-overlay.open{display:flex}.box-import-dialog{width:min(950px,100%);height:min(760px,90vh);background:#fff;border-radius:12px;box-shadow:0 20px 70px #0005;display:flex;flex-direction:column;overflow:hidden}.box-import-head{padding:14px 18px;border-bottom:1px solid #e6eae3;display:flex;justify-content:space-between;align-items:center}.box-import-head b{font-size:13px}.box-import-close{border:1px solid #dce2d8;background:#fff;border-radius:6px;padding:7px 10px;cursor:pointer}.box-import-status{padding:10px 18px;color:#65715f;font-size:11px;border-bottom:1px solid #edf0eb}.box-import-picker{flex:1;min-height:0;overflow:auto}.box-import-note{margin:16px;padding:14px;background:#f3f6ed;border:1px solid #e4eadc;border-radius:8px;color:#58654f;font-size:11px;line-height:1.5}`;
    document.head.append(style);
    modal = document.createElement("div");
    modal.className = "box-import-overlay";
    modal.innerHTML = `<section class="box-import-dialog" role="dialog" aria-modal="true" aria-labelledby="boxImportTitle"><div class="box-import-head"><b id="boxImportTitle">Import flight images from Box</b><button class="box-import-close" type="button">Close</button></div><div class="box-import-status" id="boxImportStatus" role="status">Connect to Box to choose image files.</div><div class="box-import-picker" id="boxImportPicker"></div><div class="box-import-note" id="boxImportNote"></div></section>`;
    document.body.append(modal);
    modal.querySelector(".box-import-close").onclick = close;
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    return modal;
  };

  function status(message) {
    const el = document.getElementById("boxImportStatus");
    if (el) el.textContent = message;
  }

  function close() {
    if (picker) {
      try { picker.hide(); } catch { /* The picker may already have closed itself. */ }
      picker = null;
    }
    modal?.classList.remove("open");
    busy = false;
  }

  function showSetupMessage() {
    const box = ensureModal();
    box.classList.add("open");
    status("Box import is not connected on this deployment yet.");
    document.getElementById("boxImportPicker").innerHTML = "";
    document.getElementById("boxImportNote").innerHTML = `This deployment has no Box OAuth token or file-download endpoint configured yet, so the picker cannot sign in or import files. To test real imagery now, close this dialog, choose <b>Add images from this computer</b> in Image intake, then select <b>Run first image locally</b>. A Box app with read-only OAuth plus secure token and download endpoints must be configured before Box imports can work. Never put a Box client secret or long-lived token in the frontend.`;
  }

  function loadPickerAssets() {
    if (!document.querySelector(`link[href="${cssUrl}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssUrl;
      document.head.append(link);
    }
    if (window.Box?.FilePicker) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${jsUrl}"]`);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        if (window.Box?.FilePicker) resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = jsUrl;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load Box's Content Picker."));
      document.head.append(script);
    });
  }

  async function downloadSelected(selected) {
    const allowed = selected.filter(item => item.type === "file" && /\.(jpe?g|png)$/i.test(item.name || ""));
    if (!allowed.length) throw new Error("Select one or more JPEG or PNG images.");
    if (allowed.length !== selected.length) status(`${selected.length - allowed.length} non-image items were skipped. Downloading ${allowed.length} images…`);
    else status(`Downloading ${allowed.length} image${allowed.length === 1 ? "" : "s"} from Box…`);
    const imported = new Array(allowed.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(4, allowed.length) }, async () => {
      while (next < allowed.length) {
        const index = next++;
        const item = allowed[index];
        const url = new URL(config.downloadUrl, window.location.href);
        url.searchParams.set("file_id", item.id);
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) throw new Error(`Could not download ${item.name} from Box (${response.status}).`);
        const blob = await response.blob();
        imported[index] = new File([blob], item.name, { type: blob.type || (item.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"), lastModified: Date.now() });
        status(`Downloaded ${imported.filter(Boolean).length} of ${allowed.length} images…`);
      }
    });
    await Promise.all(workers);
    if (typeof window.fieldwiseAddImages !== "function") throw new Error("Open Image intake before importing from Box.");
    await window.fieldwiseAddImages(imported);
    status(`Added ${imported.length} Box image${imported.length === 1 ? "" : "s"} to the mission batch.`);
    setTimeout(close, 900);
  }

  async function openPicker() {
    if (busy) return;
    if (!config.tokenUrl || !config.downloadUrl) {
      showSetupMessage();
      return;
    }
    busy = true;
    const box = ensureModal();
    box.classList.add("open");
    document.getElementById("boxImportPicker").innerHTML = "";
    document.getElementById("boxImportNote").textContent = "Choose image files in Box. Selected images will be copied into this mission's local intake batch; the originals remain in Box.";
    status("Connecting to Box…");
    try {
      const tokenResponse = await fetch(config.tokenUrl, { credentials: "include", cache: "no-store" });
      const tokenPayload = await tokenResponse.json().catch(() => ({}));
      if (tokenResponse.status === 401) {
        status("Sign in to Box to continue…");
        window.location.assign(tokenPayload.authorize_url || config.authUrl || "/api/box/auth");
        return;
      }
      if (!tokenResponse.ok) throw new Error(tokenPayload.error || `Box connection returned ${tokenResponse.status}.`);
      const accessToken = tokenPayload.access_token;
      if (!accessToken) throw new Error("The Box token endpoint did not return an access_token.");
      await loadPickerAssets();
      picker = new window.Box.FilePicker();
      picker.addListener("choose", async (items) => {
        if (busy) return;
        busy = true;
        try { await downloadSelected(items || []); }
        catch (error) { status(error.message || "Box import failed."); busy = false; }
      });
      picker.addListener("cancel", close);
      status("Choose JPEG or PNG flight images in Box.");
      picker.show(String(tokenPayload.folder_id || "0"), accessToken, {
        container: "#boxImportPicker",
        extensions: ["jpg", "jpeg", "png"],
        maxSelectable: 2000,
        canUpload: false,
        canSetShareAccess: false,
        canCreateNewFolder: false,
        chooseButtonLabel: "Import selected images",
        cancelButtonLabel: "Cancel",
      });
      busy = false;
    } catch (error) {
      status(error.message || "Could not connect to Box.");
      busy = false;
    }
  }

  document.addEventListener("click", event => {
    if (event.target.closest("#mcImportBox")) openPicker();
  });
})();
