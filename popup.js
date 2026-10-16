const DEFAULTS = { fontSize: 22, bottom: 12, bg: 0.6, visible: true };
const $ = (id) => document.getElementById(id);
let tabId = null;

function send(msg) {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => null);
}

function showStatus(st) {
  const el = $("status");
  if (!st || !st.ok) {
    el.className = "status err";
    el.innerHTML =
      "이 탭에서 강의 플레이어를 찾지 못했어요.<br><span class='muted'>Canvas 강의 페이지에서 영상이 로드된 뒤 다시 열어주세요.</span>";
    $("controls").hidden = true;
    $("clearRow").hidden = true;
    return;
  }
  el.className = "status";
  const badge =
    st.source === "shared" ? '<span class="badge">공유</span>' : st.source === "local" ? '<span class="badge local">내 파일</span>' : "";
  el.innerHTML = st.cueCount
    ? `<b>${escapeHtml(st.fileName || "자막")}</b>${badge}<br><span class="muted">${st.cueCount}개 자막 · 콘텐츠 ${st.contentId}</span>`
    : `플레이어 연결됨<br><span class="muted">콘텐츠 ${st.contentId} · 아직 자막 없음</span>`;
  $("controls").hidden = false;
  $("clearRow").hidden = !st.localCount;
  $("offset").textContent = (st.offset >= 0 ? "+" : "") + st.offset.toFixed(1) + "s";
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function readFile(file) {
  const buf = await file.arrayBuffer();
  // UTF-8로 먼저 읽고, 깨지면 EUC-KR(CP949)로 다시 시도
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("\uFFFD")) {
    try { text = new TextDecoder("euc-kr").decode(buf); } catch {}
  }
  if (!SRT.parseSRT(text).length) {
    alert("자막을 읽지 못했어요. SRT 형식인지 확인해주세요.");
    return;
  }
  showStatus(await send({ type: "load", text, fileName: file.name }));
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id;
  showStatus(tabId ? await send({ type: "status" }) : null);

  // 파일 선택 / 드래그
  $("file").addEventListener("change", (e) => e.target.files[0] && readFile(e.target.files[0]));
  const drop = $("drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  // 싱크
  document.querySelectorAll("button[data-d]").forEach((b) =>
    b.addEventListener("click", async () => showStatus(await send({ type: "offset", delta: Number(b.dataset.d) })))
  );
  $("reset").addEventListener("click", async () => showStatus(await send({ type: "resetOffset" })));
  $("clear").addEventListener("click", async () => {
    if (confirm("이 강의에 불러온 내 자막을 지울까요? (공유 자막이 있으면 그걸로 돌아가요)")) showStatus(await send({ type: "clear" }));
  });

  // 관리자 모드: 제목을 5번 연속 클릭하면 켜지고 꺼짐. 내보내기 버튼은 관리자에게만 보임
  const { admin: isAdmin } = await chrome.storage.local.get("admin");
  const applyAdmin = (on) => {
    $("export").hidden = !on;
    $("adminBadge").hidden = !on;
    if (!on) $("exportHint").textContent = "";
  };
  applyAdmin(!!isAdmin);
  let clicks = 0, clickTimer = null;
  $("title").addEventListener("click", async () => {
    clicks++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => (clicks = 0), 1500);
    if (clicks < 5) return;
    clicks = 0;
    const { admin } = await chrome.storage.local.get("admin");
    await chrome.storage.local.set({ admin: !admin });
    applyAdmin(!admin);
  });

  // 공유용 암호화 파일 내보내기 (관리자 전용)
  $("export").addEventListener("click", async () => {
    const st = await send({ type: "export" });
    if (!st || !st.cues || !st.cues.length) return;
    const name = await ICS.fileNameFor(st.contentId);
    const blob = new Blob([await ICS.encryptCues(st.contentId, st.cues)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $("exportHint").textContent = `${name} 을(를) 저장소 subs/ 폴더에 올리면 공유돼요.`;
  });

  // 표시 설정 (모든 강의 공통)
  const { settings: saved } = await chrome.storage.local.get("settings");
  const s = { ...DEFAULTS, ...(saved || {}) };
  const fmt = { fontSize: (v) => v + "px", bottom: (v) => v + "%", bg: (v) => Math.round(v * 100) + "%" };
  for (const k of ["fontSize", "bottom", "bg"]) {
    $(k).value = s[k];
    $(k + "V").textContent = fmt[k](s[k]);
    $(k).addEventListener("input", () => {
      s[k] = Number($(k).value);
      $(k + "V").textContent = fmt[k](s[k]);
      chrome.storage.local.set({ settings: s });
    });
  }
  $("visible").checked = s.visible;
  $("visible").addEventListener("change", () => {
    s.visible = $("visible").checked;
    chrome.storage.local.set({ settings: s });
  });
}

init();
