// iCamSub — lcms.skku.edu 플레이어 iframe 안에서 실행됩니다.
(() => {
  const DEFAULTS = { fontSize: 22, bottom: 12, bg: 0.6, visible: true };

  let video = null;
  let contentId = null;
  let localCues = []; // 내가 직접 불러온 자막 (우선)
  let sharedCues = []; // 저장소에서 받은 공유 자막
  let cues = []; // 실제로 표시 중인 자막
  let source = ""; // "local" | "shared" | ""
  let offset = 0; // 초 단위. +면 자막이 늦게, -면 빨리 나옴
  let fileName = "";
  let settings = { ...DEFAULTS };

  let overlay = null;
  let box = null;
  let lastKey = "";
  let nativeTrack = null; // 비디오 자체가 전체화면일 때 쓰는 대체 트랙
  let toastUntil = 0;

  // ---------- 콘텐츠 식별 ----------
  function detectContentId() {
    const m = location.pathname.match(/\/em\/([0-9a-z]+)/i);
    if (m) return m[1];
    const p = new URLSearchParams(location.search);
    if (p.get("content_id")) return p.get("content_id");
    const src = video && (video.currentSrc || video.src);
    const m2 = src && src.match(/skku\d+\/([0-9a-z]+)\//i);
    if (m2) return m2[1];
    return null;
  }
  const storeKey = () => "subs:" + contentId;

  function pickActive() {
    if (localCues.length) { cues = localCues; source = "local"; }
    else if (sharedCues.length) { cues = sharedCues; source = "shared"; }
    else { cues = []; source = ""; }
    lastKey = "";
    rebuildNativeTrack();
  }

  // ---------- 저장 ----------
  async function loadSaved() {
    const data = await chrome.storage.local.get([storeKey(), "settings"]);
    settings = { ...DEFAULTS, ...(data.settings || {}) };
    const saved = data[storeKey()];
    localCues = (saved && saved.cues) || [];
    offset = (saved && saved.offset) || 0;
    fileName = (saved && saved.fileName) || "";
    applyStyle();
    pickActive();
  }
  function save() {
    return chrome.storage.local.set({
      [storeKey()]: { cues: localCues, offset, fileName, savedAt: Date.now() },
    });
  }

  async function loadShared() {
    if (!contentId) return;
    const id = contentId;
    const got = await ICS.fetchShared(id);
    if (id !== contentId) return; // 그 사이 다른 영상으로 바뀐 경우
    sharedCues = got || [];
    pickActive();
    if (source === "shared") flash(`공유 자막 ${cues.length}개 적용됨`);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) {
      settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
      applyStyle();
      lastKey = "";
    }
  });

  // ---------- 오버레이 ----------
  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "srt-ov-root";
    box = document.createElement("div");
    box.className = "srt-ov-box";
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    applyStyle();
  }

  function applyStyle() {
    if (!overlay) return;
    overlay.style.setProperty("--srt-font", settings.fontSize + "px");
    overlay.style.setProperty("--srt-bottom", settings.bottom + "%");
    overlay.style.setProperty("--srt-bg", `rgba(0,0,0,${settings.bg})`);
  }

  function placeOverlay() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    // 플레이어 컨테이너가 전체화면이면 그 안으로 옮겨야 보입니다.
    const host = fs && fs !== video && fs.contains(video) ? fs : document.body;
    if (overlay.parentNode !== host) host.appendChild(overlay);

    const r = video.getBoundingClientRect();
    overlay.style.left = r.left + "px";
    overlay.style.top = r.top + "px";
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";

    // 비디오 요소 자체가 전체화면이면 DOM 오버레이는 안 보이므로 기본 트랙 사용
    const videoItselfFs = fs === video;
    overlay.style.display = videoItselfFs || !settings.visible ? "none" : "";
    if (nativeTrack) nativeTrack.mode = videoItselfFs && settings.visible ? "showing" : "hidden";
  }

  function render() {
    const t = video.currentTime - offset;
    const active = SRT.activeCues(cues, t);
    const key = active.map((c) => c.start).join("|");
    if (key === lastKey) return;
    lastKey = key;
    box.textContent = "";
    for (const c of active) {
      for (const line of c.text.split("\n")) {
        const span = document.createElement("span");
        span.className = "srt-ov-line";
        span.textContent = line;
        box.appendChild(span);
      }
    }
    box.style.visibility = active.length ? "visible" : "hidden";
  }

  function loop() {
    if (video && video.isConnected && cues.length) {
      ensureOverlay();
      placeOverlay();
      render();
    } else if (overlay && Date.now() > toastUntil) {
      overlay.style.display = "none";
    }
    requestAnimationFrame(loop);
  }

  // 비디오 요소 자체 전체화면 대비용 TextTrack
  function rebuildNativeTrack() {
    if (!video) return;
    if (!nativeTrack) nativeTrack = video.addTextTrack("subtitles", "iCamSub", "ko");
    if (nativeTrack.cues) for (const c of [...nativeTrack.cues]) nativeTrack.removeCue(c);
    for (const c of cues) {
      const s = Math.max(0, c.start + offset);
      const e = Math.max(s + 0.01, c.end + offset);
      nativeTrack.addCue(new VTTCue(s, e, c.text));
    }
    nativeTrack.mode = "hidden";
  }

  // ---------- 비디오 찾기 ----------
  function pickVideo() {
    const vids = [...document.querySelectorAll("video")];
    if (!vids.length) return null;
    return vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  }

  async function attach(v) {
    if (v === video) return;
    video = v;
    nativeTrack = null;
    sharedCues = [];
    contentId = detectContentId();
    if (!contentId) {
      // src가 아직 없으면 로드된 뒤 다시 시도
      v.addEventListener("loadedmetadata", () => { video = null; attach(v); }, { once: true });
      return;
    }
    await loadSaved();
    loadShared();
  }

  const mo = new MutationObserver(() => {
    const v = pickVideo();
    if (v && v !== video) attach(v);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  const first = pickVideo();
  if (first) attach(first);
  requestAnimationFrame(loop);

  // ---------- 공통 동작 ----------
  async function setLocal(newCues, name) {
    localCues = newCues;
    fileName = name || "";
    offset = 0;
    await save();
    pickActive();
  }
  async function shiftOffset(delta) {
    offset = Math.round((offset + delta) * 100) / 100;
    await save();
    rebuildNativeTrack();
    lastKey = "";
  }

  // ---------- 팝업과 통신 ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!video || !contentId) return false; // 비디오 없는 프레임은 응답하지 않음

    const status = () => ({
      ok: true,
      contentId,
      fileName: source === "shared" ? "공유 자막" : fileName,
      source,
      cueCount: cues.length,
      localCount: localCues.length,
      offset,
    });

    (async () => {
      let extra = {};
      switch (msg.type) {
        case "load":
          await setLocal(SRT.parseSRT(msg.text), msg.fileName);
          break;
        case "offset":
          await shiftOffset(msg.delta);
          break;
        case "resetOffset":
          await shiftOffset(-offset);
          break;
        case "clear": // 내 자막만 지움 (공유 자막이 있으면 그걸로 돌아감)
          localCues = [];
          fileName = "";
          offset = 0;
          await chrome.storage.local.remove(storeKey());
          pickActive();
          if (box) box.textContent = "";
          break;
        case "export":
          extra = { cues: localCues };
          break;
      }
      sendResponse({ ...status(), ...extra });
    })();
    return true;
  });

  // ---------- 단축키 (플레이어를 클릭해 포커스가 있을 때) ----------
  // [ / ] : 자막 0.5초 빠르게/늦게,  Shift+S : 자막 켜기/끄기
  document.addEventListener("keydown", async (e) => {
    if (!video || !cues.length) return;
    const tag = (e.target && e.target.tagName) || "";
    if (/INPUT|TEXTAREA/.test(tag)) return;
    if (e.key === "[" || e.key === "]") {
      await shiftOffset(e.key === "[" ? -0.5 : 0.5);
      flash(`자막 싱크 ${offset >= 0 ? "+" : ""}${offset.toFixed(1)}초`);
    } else if (e.key === "S" && e.shiftKey) {
      settings.visible = !settings.visible;
      chrome.storage.local.set({ settings });
    }
  });

  // ---------- 플레이어 위로 SRT 파일 끌어놓기 ----------
  const isSubFile = (f) => f && /\.(srt|vtt)$/i.test(f.name);
  document.addEventListener("dragover", (e) => {
    if (video && [...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) e.preventDefault();
  }, true);
  document.addEventListener("drop", async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!video || !contentId || !isSubFile(f)) return;
    e.preventDefault();
    e.stopPropagation();
    const buf = await f.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) {
      try { text = new TextDecoder("euc-kr").decode(buf); } catch {}
    }
    const parsed = SRT.parseSRT(text);
    if (!parsed.length) return flash("자막을 읽지 못했어요");
    await setLocal(parsed, f.name);
    flash(`자막 ${cues.length}개 불러옴`);
  }, true);

  function flash(text) {
    ensureOverlay();
    if (video) placeOverlay();
    overlay.style.display = "";
    let n = overlay.querySelector(".srt-ov-toast");
    if (!n) {
      n = document.createElement("div");
      n.className = "srt-ov-toast";
      overlay.appendChild(n);
    }
    n.textContent = text;
    n.style.opacity = "1";
    toastUntil = Date.now() + 1800;
    clearTimeout(n._t);
    n._t = setTimeout(() => (n.style.opacity = "0"), 1500);
  }
})();
