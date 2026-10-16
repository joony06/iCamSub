// iCamSub 공유 자막: 콘텐츠 ID 기반 파일명 해시 + AES-GCM 암호화
(function (global) {
  // ▼ 자막 저장소 주소
  const SUBS_BASE = "https://raw.githubusercontent.com/joony06/iCamSub/main/subs/";

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function sha256(text) {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  }
  const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  const b64 = (b) => btoa(String.fromCharCode(...b));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // 저장소에 올라갈 파일명 (콘텐츠 ID를 몰라서는 어떤 강의인지 알 수 없음)
  async function fileNameFor(contentId) {
    return hex(await sha256("icamsub:name:" + contentId)).slice(0, 32) + ".json";
  }

  async function keyFor(contentId) {
    const raw = await sha256("icamsub:key:" + contentId);
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async function encryptCues(contentId, cues) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await keyFor(contentId),
      enc.encode(JSON.stringify({ cues }))
    );
    // b64 변환 시 큰 배열로 인한 스택 초과 방지
    const bytes = new Uint8Array(data);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return JSON.stringify({ v: 1, iv: b64(iv), data: btoa(s) });
  }

  async function decryptCues(contentId, json) {
    const { iv, data } = JSON.parse(json);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv) },
      await keyFor(contentId),
      unb64(data)
    );
    return JSON.parse(dec.decode(plain)).cues;
  }

  // 공유 자막 조회. 없으면 null
  async function fetchShared(contentId) {
    if (SUBS_BASE.includes("YOUR_GITHUB_ID")) return null;
    try {
      const res = await fetch(SUBS_BASE + (await fileNameFor(contentId)), { cache: "no-cache" });
      if (!res.ok) return null;
      return await decryptCues(contentId, await res.text());
    } catch {
      return null;
    }
  }

  global.ICS = { fileNameFor, encryptCues, decryptCues, fetchShared };
})(typeof window !== "undefined" ? window : globalThis);
