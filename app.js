// AD'S UP v2 — Çoklu motor: görselden RENKLİ 3D videoya
// Zincir: Hunyuan-2 (resmî) → Hunyuan-2mv → Hunyuan-2.1 → TRELLIS
// Her motor önce RENKLI üretimi, sonra yedek beyaz üretimi dener; kota penceresi açıkkenbirinde başarır.

const $ = (id) => document.getElementById(id);
const drop = $("drop"), preview = $("preview"), btnOlustur = $("btnOlustur");
const fileInput = $("fileInput");
const statusEl = $("status"), bar = $("bar"), barFill = $("barFill"), logEl = $("log");
const secViz = $("secViz"), vidList = $("vidList");
const canvas = $("c3d");

import { generateLocal3D, local3dProgress } from "./local3d.js";
local3dProgress((m) => log(m));

const log = (m) => { logEl.style.display = "block"; logEl.textContent += m + "\n"; logEl.scrollTop = 1e9; };
const setStatus = (t, pct) => { statusEl.textContent = t; if (pct != null) { bar.style.display = "block"; barFill.style.width = pct + "%"; } };

// ---------- 1) Görsel seçimi ----------
let file = null;
drop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
["dragover", "dragenter"].forEach((e) =>
  drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (ev) => {
  ev.preventDefault(); drop.classList.remove("over");
  if (ev.dataTransfer.files[0]) setFile(ev.dataTransfer.files[0]);
});

function setFile(f) {
  if (!f || !f.type.startsWith("image/")) return;
  file = f;
  preview.src = URL.createObjectURL(f);
  preview.style.display = "block";
  btnOlustur.disabled = false;
  setStatus("Görsel hazır: " + f.name);
  log("Görsel seçildi: " + f.name + " (" + Math.round(f.size / 1024) + " KB)");
}

// ---------- 2) Çoklu motor API ----------
const PROVIDERS = [
  { name: "Hunyuan-2 (resmi)",  base: "https://tencent-hunyuan3d-2.hf.space",      v4: true,  kind: "hunyuan" },
  { name: "Hunyuan-2mv",        base: "https://tencent-hunyuan3d-2mv.hf.space",   v4: true,  kind: "hunyuan" },
  { name: "Hunyuan-2.1",        base: "https://tencent-hunyuan3d-2-1.hf.space",   v4: true,  kind: "hunyuan" },
  { name: "TRELLIS",            base: "https://trellis-community-trellis.hf.space", v4: false, kind: "trellis" }
];
const upPath = (p) => p.v4 ? p.base + "/upload" : p.base + "/gradio_api/upload";
const callPath = (p, fn) => p.v4 ? p.base + "/call/" + fn : p.base + "/gradio_api/call/" + fn;

async function uploadTo(p, f) {
  const fd = new FormData();
  fd.append("files", f, f.name);
  const r = await fetch(upPath(p), { method: "POST", body: fd });
  if (!r.ok) throw new Error("Yükleme hatası: HTTP " + r.status);
  const arr = await r.json();
  return { path: arr[0], meta: { _type: "gradio.FileData" }, orig_name: f.name };
}

async function tryOne(p, fn, file, label) {
  const fileObj = await uploadTo(p, file);
  log("Yüklendi → " + p.name + " | " + fn);
  const payloadData = p.kind === "trellis"
    ? [fileObj, null, Math.floor(Math.random() * 100000), 7.5, 12, 3, 12, "stochastic", 0.95, 1024]
    : [
        null, fileObj, null, null, null, null,   // caption, image, multiview
        30, 5.0, Math.floor(Math.random() * 10000),
        256, true, 8000, true
      ];
  const join = await fetch(callPath(p, fn), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: payloadData })
  });
  const j = await join.json();
  if (!join.ok || !j.event_id) throw new Error("Kuyruk hatası: " + JSON.stringify(j).slice(0, 160));
  setStatus(label + " kuyrukta…", 40);
  const sse = new EventSource(callPath(p, fn) + "/" + j.event_id);
  const result = await new Promise((resolve, reject) => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      if (ticks % 5 === 0) { let w = parseFloat(barFill.style.width) || 40; w = Math.min(80, w + 3); setStatus(label + "… " + Math.round(w) + "%", w); }
    }, 4000);
    sse.addEventListener("process_generating", (e) => log("…işlem: " + String(e.data || "").slice(0, 110)));
    sse.addEventListener("complete", (e) => {
      clearInterval(timer); sse.close();
      try {
        const chunks = JSON.parse(e.data);
        const arr = Array.isArray(chunks) ? chunks : [chunks];
        const files = [];
        for (const c of arr) {
          const v = c && (c.value || (c.path ? c : null));
          if (v && (v.url || v.path)) files.push(v);
        }
        if (!files.length) { reject(new Error("Sonuç bulunamadı")); return; }
        let pick;
        if (p.kind === "hunyuan" && fn === "generation_all") {
          pick = files.find(v => String(v.path || "").includes("textured") || String(v.orig_name || "").includes("textured")) || files[files.length - 1];
        } else {
          pick = files.find(v => String(v.path || v.url || "").includes(".glb")) || files[0];
        }
        resolve(pick);
      } catch (err) { reject(err); }
    });
    sse.addEventListener("error", (e) => { clearInterval(timer); sse.close(); reject(new Error("GPU kota/kapasite reddi (SSE)")); });
  });
  return result;
}

const glbDownloadURLs = (p, result) => {
  const cands = [];
  if (result.path) {
    cands.push((result.apiV4 ? p.base : p.base + "/gradio_api") + "/file=" + result.path);
    cands.push(p.base + "/file=" + result.path);
    cands.push(p.base + "/gradio_api/file=" + result.path);
  }
  if (result.url) cands.push(result.url);
  return cands;
};

async function fetchGlb(p, result) {
  setStatus("3D model indiriliyor…", 85);
  for (const u of glbDownloadURLs(p, result)) {
    try {
      const blob = await (await fetch(u)).blob();
      const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      const magic = String.fromCharCode(...head);
      if (magic === "glTF") return blob;
      log("Uyumsuz yanıt (" + magic + ") — sonraki adrese geçiliyor");
    } catch (e) { log("İndirme denemesi başarısız: " + u.slice(-40)); }
  }
  return null;
}

async function tryEngineChain(file) {
  // Her motor: renkli üretim, sonra (sadece Hunyuan) beyaz yedek
  let lastErr = null;
  for (const p of PROVIDERS) {
    const fns = p.kind === "hunyuan" ? ["generation_all"] : ["generate_and_extract_glb"]; // beyaz shape_generation yarışa alınmaz
    for (const fn of fns) {
      try {
        setStatus(p.name + " deneniyor…", 25);
        log(p.name + (p.kind === "hunyuan" ? (fn === "generation_all" ? " (renkli)" : " (beyaz)") : " (renkli GLB)") + " → " + fn);
        const result = await tryOne(p, fn, file, p.name + " üretiliyor");
        const glbBlob = await fetchGlb(p, result);
        if (!glbBlob) throw new Error("Model dosyası indirilemedi");
        setStatus("Model hazır! — " + p.name, 100);
        log("Model hazır ✓ (" + p.name + ")");
        return glbBlob;
      } catch (e) {
        lastErr = e;
        log("Başarısız [" + p.name + " / " + fn + "]: " + e.message + " → sıradaki motora geçiliyor");
        await new Promise(r => setTimeout(r, 600));
      }
    }
  }
  throw new Error("Hugging Face GPU kotası şu anda dolu (son hata: " + (lastErr ? lastErr.message : "?") + ")");
}

async function generate3D(file) {
  setStatus("Görsel hazırlanıyor…", 10);
  log("Yükleniyor: " + file.name);

  // 1) Yerel motoru arka planda başlat — sunucu yok, kota yok, GARANTİ sonuç
  const localTask = generateLocal3D(file)
    .then((glb) => ({ src: "local", glb }))
    .catch((e) => { log("Yerel motor: " + e.message); return { src: "local-err", err: e }; });

  // 2) HF AI zinciri (HD renkli): 2 tur, arada 15 sn — paralel çalışıyor
  const hfTask = (async () => {
    let lastErr = null;
    for (let a = 0; a < 2; a++) {
      try { return { src: "hf", glb: await tryEngineChain(file) }; }
      catch (e) {
        lastErr = e;
        if (a === 0) {
          log("HF zinciri 1. tur: " + e.message + " → 15 sn sonra 2. tur (yerel motor paralel hazırlanıyor)");
          await new Promise((r) => setTimeout(r, 15_000));
        }
      }
    }
    return { src: "hf-err", err: lastErr };
  })();

  // 3) Hangi motor önce biterse onu göster
  let winner = await Promise.race([localTask, hfTask]);
  if (winner.src === "local-err") winner = await hfTask;
  else if (winner.src === "hf-err") winner = await localTask;

  if (!winner || winner.src === "hf-err" || winner.src === "local-err") {
    throw new Error("3D üretilemedi: " + ((winner && winner.err && winner.err.message) || "bilinmeyen") + " — daha sade görsel deneyin");
  }
  if (winner.src === "hf") {
    setStatus("Model hazır! (AI HD, renkli)", 100);
    log("Sonuç: Hunyuan3D AI modeli (HD kalite, renkli)");
  } else {
    setStatus("Model hazır! (yerel motor, renkli)", 100);
    log("Sonuç: tarayıcıda yerel üretim — sunucu yok, kota yok, herkes için çalışır");
  }
  return winner.glb;
}

// ---------- 3) Three.js sahne ----------
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Videoya gömülecek logo (sağ üst)
const logoImg = new Image();
logoImg.src = "assets/logo.png";

let renderer, scene, camera, controls, model = null, turning = false, frameId = 0, recTimer = 0;
function initScene() {
  if (scene) return;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);
  camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.set(0, 0.4, 3.2);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1.0);
  const dir = new THREE.DirectionalLight(0xffffff, 2.4);
  dir.position.set(3, 5, 4);
  const dir2 = new THREE.DirectionalLight(0xffffff, 1.4);
  dir2.position.set(-4, 2, -3);
  scene.add(hemi, dir, dir2);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
}

function drawCompositeFrame() {
  if (composite.width !== canvas.width || composite.height !== canvas.height) {
    composite.width = canvas.width;
    composite.height = canvas.height;
  }
  cctx.clearRect(0, 0, composite.width, composite.height);
  cctx.drawImage(canvas, 0, 0);
  if (logoImg.complete && logoImg.naturalWidth) {
    const pad = Math.round(composite.width * 0.022);
    const lw = Math.round(composite.width * 0.16);
    const lh = Math.round(lw * (logoImg.naturalHeight / logoImg.naturalWidth));
    const chipPadX = Math.round(lh * 0.35);
    const chipPadY = Math.round(lh * 0.25);
    const cw = lw + chipPadX * 2, ch = lh + chipPadY * 2;
    const cx = composite.width - cw - pad, cy = pad;
    cctx.save();
    cctx.globalAlpha = 0.88;
    cctx.fillStyle = "#ffffff";
    cctx.beginPath();
    if (cctx.roundRect) cctx.roundRect(cx, cy, cw, ch, Math.round(ch * 0.3));
    else cctx.rect(cx, cy, cw, ch);
    cctx.fill();
    cctx.globalAlpha = 0.92;
    cctx.drawImage(logoImg, cx + chipPadX, cy + chipPadY, lw, lh);
    cctx.restore();
  }
}

function stepScene() {
  resize();
  if (turning && model) model.rotation.y += 0.012;
  controls.update();
  renderer.render(scene, camera);
  if (recorder && recorder.state === "recording") drawCompositeFrame();
}

function loop() {
  frameId = requestAnimationFrame(loop);
  if (!recTimer) stepScene();
}

function resize() {
  if (!renderer) return;
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 480;
  if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) {
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
window.addEventListener("resize", resize);

function showModel(glbBlob) {
  initScene();
  resize();
  if (!frameId) loop();
  const url = URL.createObjectURL(glbBlob);
  new GLTFLoader().load(url, (gltf) => {
    resize();
    // Renk kontrolü: texture'lı mı?
    let textured = false, texInfo = "";
    gltf.scene.traverse((o) => {
      const m = o.material;
      if (m && m.map) {
        textured = true;
        if (!texInfo && m.map.image) texInfo = m.map.image.width + "x" + m.map.image.height;
      }
    });
    window.__adsup.lastModel = { textured, texInfo, size: glbBlob.size };
    log("RENK KONTROLÜ: " + (textured ? "✔ texture VAR (renkli, " + texInfo + ")" : "✖ texture YOK (beyaz/neutral mesh)"));
    if (model) scene.remove(model);
    model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    model.position.x = -center.x; model.position.y = -center.y; model.position.z = -center.z;
    model.scale.setScalar(1.6 / maxDim);
    scene.add(model);
    turning = true;
    URL.revokeObjectURL(url);
    secViz.style.display = "block";
    secViz.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// ---------- 4) Video kaydı ----------
let recorder = null, chunks = [];
const composite = document.createElement("canvas");
const cctx = composite.getContext("2d");
function pickMime() {
  const cands = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return cands.find((m) => MediaRecorder.isTypeSupported(m)) || "";
}

function startRecording() {
  resize();
  composite.width = canvas.width;
  composite.height = canvas.height;
  drawCompositeFrame();
  const stream = composite.captureStream(30);
  const mime = pickMime();
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start(250);
  if (recTimer) clearInterval(recTimer);
  recTimer = setInterval(stepScene, 33);
}

function stopRecording() {
  return new Promise((res) => {
    if (recTimer) { clearInterval(recTimer); recTimer = 0; }
    if (!recorder || recorder.state === "inactive") return res(null);
    recorder.onstop = () => {
      const mime = (recorder.mimeType || "video/webm").split(";")[0];
      const ext = mime.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      addVideoCard(url, ext, blob);
      res(blob);
    };
    recorder.stop();
  });
}

function addVideoCard(url, ext, blob) {
  const kb = Math.round(blob.size / 1024);
  const wrap = document.createElement("div");
  wrap.className = "vidcard";
  wrap.innerHTML = `
    <video controls src="${url}"></video>
    <div class="meta"><span>${ext.toUpperCase()} · ${kb} KB</span>
    <span style="display:inline-flex;gap:6px;flex-wrap:wrap">
      <a class="dl" href="${url}" download="adsup-3d-video.${ext}">⬇ İndir</a>
      <button class="dl" data-drive>☁ Drive'a Kaydet</button>
    </span></div>`;
  wrap.querySelector("[data-drive]").addEventListener("click", (e) => saveToDrive(blob, e.currentTarget));
  vidList.prepend(wrap);
}

// ---------- 4.5) Google Drive'a kaydet ----------
// Kurulum (bir kezlik): console.cloud.google.com → Google Drive API etkin →
// OAuth client ID (Web) oluştur → Authorized JS origin: https://bilfen.github.io
// Client ID'yi DRIVE.clientId alanına yaz. İsteğe bağlı: ortak klasör için DRIVE.folderId.
const DRIVE = {
  clientId: "",           // ← ZORUNLU: OAuth Web Client ID ("xxxx.apps.googleusercontent.com")
  folderId: "",           // ← İSTEĞE BAĞLI: ortak klasör ID; boşsa "Drive'ım" köküne gider
  scope: "https://www.googleapis.com/auth/drive.file"
};
let driveToken = null;

function driveClientReady() {
  return typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
}

function getDriveToken() {
  return new Promise((resolve, reject) => {
    if (!driveClientReady()) return reject(new Error("Google modülü yüklenemedi — internet bağlantısını kontrol edin"));
    const client = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE.clientId,
      scope: DRIVE.scope,
      callback: (resp) => {
        if (resp.error) reject(new Error("Google oturumu reddedildi: " + resp.error));
        else resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err.message || "Google oturumu açılamadı"))
    });
    client.requestAccessToken({ prompt: "" }); // açık oturum varsa sessiz, yoksa popup açar
  });
}

async function driveUpload(token, blob, name, mime) {
  const boundary = "ADSUP" + Math.random().toString(36).slice(2);
  const meta = { name, mimeType: mime };
  if (DRIVE.folderId) meta.parents = [DRIVE.folderId];
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--\r\n`
  ], { type: "multipart/related; boundary=" + boundary });
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { driveToken = null; throw new Error("Oturum yenilenmeli (401)"); }
  if (!r.ok) throw new Error("Drive hatası: " + ((j.error && j.error.message) || r.status));
  return j;
}

async function saveToDrive(blob, btn) {
  const original = btn.innerHTML;
  try {
    if (!DRIVE.clientId) {
      btn.textContent = "☁ Önce ayar gerek";
      setStatus("Drive'a kaydet için öğretmenin Google Client ID ayarı gerekli (app.js başındaki DRIVE bölümü). Kurulum talimatı README'de.");
      await new Promise(r => setTimeout(r, 4000));
      btn.innerHTML = original;
      return;
    }
    btn.disabled = true;
    btn.textContent = "☁ Yükleniyor…";
    setStatus("Google Drive'a yükleniyor…", null);
    let token = driveToken || await getDriveToken();
    let res;
    try { res = await driveUpload(token, blob, "adsup-3d-video.webm", blob.type || "video/webm"); }
    catch (e) {
      if (!/401|Oturum yenilenmeli/.test(e.message)) throw e;
      token = await getDriveToken();
      res = await driveUpload(token, blob, "adsup-3d-video.webm", blob.type || "video/webm");
    }
    driveToken = token;
    btn.textContent = "✔ Drive'a kaydedildi";
    setStatus("✔ Google Drive'a kaydedildi: " + res.name + " — " + (res.webViewLink || "https://drive.google.com/drive/my-drive"));
    log("Drive'a yüklendi: id=" + res.id);
  } catch (err) {
    console.error(err);
    btn.textContent = "⚠ Drive hatası";
    setStatus("Drive'a kaydetmede hata: " + err.message);
    log("Drive hatası: " + err.message);
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.innerHTML = original; }, 3500);
  }
}

$("btnTurn").addEventListener("click", () => { turning = !turning; });
$("btnRec5").addEventListener("click", async () => {
  turning = true;
  startRecording();
  await new Promise((r) => setTimeout(r, 10_000));
  await stopRecording();
});
$("btnRecManual").addEventListener("click", async () => {
  if (!recorder || recorder.state === "inactive") { startRecording(); $("btnRecManual").textContent = "⏹ Kaydı durdur"; }
  else { await stopRecording(); $("btnRecManual").textContent = "● Kaydı başlat / durdur"; }
});

// Test / otomasyon kancası
window.__adsup = { setFile, generate3D, showModel, composite };
Object.defineProperty(window.__adsup, "lastModel", { value: null, writable: true });

btnOlustur.addEventListener("click", async () => {
  if (!file) return;
  btnOlustur.disabled = true;
  logEl.textContent = "";
  try {
    const glb = await generate3D(file);
    showModel(glb);
  } catch (err) {
    console.error(err);
    setStatus("Hata: " + err.message + " — Lütfen tekrar deneyin.");
    bar.style.display = "none";
  } finally {
    btnOlustur.disabled = false;
  }
});