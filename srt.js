// SRT / WebVTT 파서. content.js와 popup.js 양쪽에서 사용합니다.
(function (global) {
  function toSeconds(ts) {
    // 00:01:02,345 / 00:01:02.345 / 01:02.345 모두 허용
    const m = ts.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/);
    if (!m) return NaN;
    const h = Number(m[1] || 0);
    const min = Number(m[2]);
    const s = Number(m[3]);
    const ms = Number(m[4].padEnd(3, "0"));
    return h * 3600 + min * 60 + s + ms / 1000;
  }

  function cleanText(t) {
    return t
      .replace(/<[^>]+>/g, "") // <i>, <b>, <font> 등 태그 제거
      .replace(/\{\\[^}]*\}/g, "") // {\an8} 같은 ASS 태그 제거
      .trim();
  }

  function parseSRT(raw) {
    const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const blocks = text.split(/\n{2,}/);
    const cues = [];
    for (const block of blocks) {
      const lines = block.split("\n").filter((l) => l.trim() !== "");
      const idx = lines.findIndex((l) => l.includes("-->"));
      if (idx === -1) continue;
      const [a, b] = lines[idx].split("-->");
      const start = toSeconds(a);
      const end = toSeconds(b);
      if (isNaN(start) || isNaN(end)) continue;
      const body = cleanText(lines.slice(idx + 1).join("\n"));
      if (body) cues.push({ start, end, text: body });
    }
    cues.sort((x, y) => x.start - y.start);
    return cues;
  }

  // 이진 탐색으로 현재 시간에 해당하는 자막(겹치는 것 포함) 반환
  function activeCues(cues, t) {
    let lo = 0, hi = cues.length - 1, last = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) { last = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const out = [];
    for (let i = last; i >= 0 && i > last - 5; i--) {
      if (cues[i].end > t) out.unshift(cues[i]);
    }
    return out;
  }

  global.SRT = { parseSRT, activeCues };
})(typeof window !== "undefined" ? window : globalThis);
