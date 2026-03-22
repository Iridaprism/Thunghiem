/**
 * ============================================================
 *  AudioEngine.js — RAPASEOS V47.2 · ULTIMATE PSYCHO-SHIFT
 * ============================================================
 *  Tách từ IRIDAPRISM V47. Không chứa HTML / CSS / UI logic.
 *
 *  API công khai:
 *    window.generateAudio(text, personaType) → Promise<object>
 *    window.generateAudioBlob(text, voiceId) → Promise<Blob>
 *
 *  Giá trị personaType:
 *    1 → 🌸 Melting Sweet   (cao, nhí nhảnh, năng lượng tràn trề)
 *    2 → 🛡️ Safe Harbor     (nam, trầm ấm, nhanh hơn — tự nhiên hơn)
 *    3 → 🍷 Deep Chill      (trung tính, thủ thỉ, lo-fi whisper)
 *    4 → 💬 Human Connect   (đọc text thật + thêm hesitation ngẫu nhiên)
 *
 *  CHANGELOG V47.2:
 *    ✅ FIX: Persona 4 giờ đọc text THẬT (không còn hardcode câu cố định)
 *    ✅ FIX: Persona 2 & 3 tốc độ tự nhiên hơn (0.96 / 0.89)
 *    ✅ FIX: _chunkText guard -1 từ .search() rõ ràng hơn
 *    ✅ FIX: generateAudio() throw rõ khi không có blob nào tải được
 * ============================================================
 */

(function (global) {
  "use strict";

  // ──────────────────────────────────────────────────────────
  // 🔧 CẤU HÌNH PROXY (vượt tường lửa Google TTS)
  // ──────────────────────────────────────────────────────────
  const PROXY_BASE  = "https://api.codetabs.com/v1/proxy?quest=";
  const GOOGLE_BASE = "https://translate.googleapis.com/translate_tts";
  const MAX_CHARS   = 195; // Buffer an toàn (Google TTS ~200 ký tự/request)


  // ──────────────────────────────────────────────────────────
  // 🧠 BẢNG CẤU HÌNH NHÂN CÁCH (Micro-Shift Recipe)
  // ──────────────────────────────────────────────────────────
  const PERSONAS = {

    // 🌸 MELTING SWEET ─────────────────────────────────────
    // Ép thanh quản lên 1.18x → siêu cao, nhí nhảnh, cưng muốn xỉu.
    // preservesPitch = false → Web Audio Engine tự kéo tần số, không bù.
    1: {
      name          : "🌸 Melting Sweet",
      playbackRate  : 1.18,
      preservesPitch: false,
      transform(text) {
        return text
          .replace(/,/g, "!!!")
          .replace(/\./g, "!!!");
      },
    },

    // 🛡️ SAFE HARBOR ───────────────────────────────────────
    // Giọng nam trưởng thành. Tốc độ 0.96x — vừa đủ chậm để nghe dày,
    // vừa đủ nhanh để không bị đơ cứng như robot (fix V47.2).
    // preservesPitch = false → hạ nhẹ toàn bộ tần số cùng tốc độ.
    2: {
      name          : "🛡️ Safe Harbor",
      playbackRate  : 0.96,   // ← V47.2: 0.90 → 0.96 (tự nhiên hơn)
      preservesPitch: false,
      transform(text) {
        return text
          .replace(/,/g, ". ")
          .replace(/\./g, "... ");
      },
    },

    // 🍷 DEEP CHILL ────────────────────────────────────────
    // Giọng trung tính, thủ thỉ. Tốc độ 0.89x — đủ chậm để lo-fi,
    // nhưng không quá trễ như V47.1 (0.82x nghe hơi bất thường).
    // preservesPitch = false → để tần số thực sự thấp hơn.
    3: {
      name          : "🍷 Deep Chill",
      playbackRate  : 0.89,   // ← V47.2: 0.82 → 0.89 (tự nhiên hơn)
      preservesPitch: false,
      transform(text) {
        return text
          .replace(/[?!]/g, ".")
          .replace(/,/g, "... ");
      },
    },

    // 💬 HUMAN CONNECT ─────────────────────────────────────
    // ✅ FIX V47.2: Giờ đọc TEXT THẬT thay vì câu hardcode cố định!
    //
    // Transform thêm hesitation tự nhiên vào text gốc:
    //   - Mở đầu ngẫu nhiên (À... / Ừm... / À ừm,) → cảm giác đang nghĩ
    //   - Phẩy → "... " (ngừng lại giữa ý)
    //   - ! và ? → "." (bỏ hết cảm xúc thái quá, nghe thủ thỉ hơn)
    //
    // playbackRate 1.08x → thoát tông gốc Google TTS, nghe người thật hơn.
    4: {
      name          : "💬 Human Connect",
      playbackRate  : 1.08,
      preservesPitch: false,
      transform(text) {
        // Mở đầu ngập ngừng ngẫu nhiên — mỗi lần khác nhau
        const openers = ["À... ", "Ừm... ", "À ừm, "];
        const opener  = openers[Math.floor(Math.random() * openers.length)];
        return (opener + text)
          .replace(/,\s*/g, "... ")   // phẩy → dừng suy nghĩ
          .replace(/[?!]\s*/g, ". "); // hỏi/cảm thán → điềm tĩnh
      },
    },
  };


  // ──────────────────────────────────────────────────────────
  // ✂️ HÀM NỘI BỘ: Chunk text tại ranh giới từ (KHÔNG cắt giữa chữ)
  // ──────────────────────────────────────────────────────────
  /**
   * Chia text thành mảng các đoạn, mỗi đoạn ≤ maxChars ký tự.
   * Ưu tiên cắt tại: dấu câu → dấu phẩy → khoảng trắng → cắt cứng.
   *
   * @param {string} text
   * @param {number} maxChars
   * @returns {string[]}
   */
  function _chunkText(text, maxChars) {
    if (text.length <= maxChars) return [text];

    const chunks    = [];
    let   remaining = text.trim();

    while (remaining.length > maxChars) {
      const slice = remaining.substring(0, maxChars);
      let   cut   = -1;

      // Ưu tiên 1: vị trí dấu câu kết thúc cuối cùng trong slice (. ! ? …)
      const sentenceMatch = slice.search(/[.!?…][^.!?…]*$/);
      if (sentenceMatch !== -1 && sentenceMatch > maxChars * 0.4) {
        cut = sentenceMatch + 1; // bao gồm luôn dấu câu
      }

      // Ưu tiên 2: vị trí dấu phẩy cuối cùng trong slice
      if (cut === -1) {
        const commaMatch = slice.search(/[,][^,]*$/);
        if (commaMatch !== -1 && commaMatch > maxChars * 0.4) {
          cut = commaMatch + 1;
        }
      }

      // Ưu tiên 3: khoảng trắng gần nhất (cắt giữa từ)
      if (cut === -1) {
        const spaceIdx = slice.lastIndexOf(" ");
        cut = spaceIdx > 0 ? spaceIdx : maxChars; // cắt cứng nếu không có khoảng trắng
      }

      chunks.push(remaining.substring(0, cut).trim());
      remaining = remaining.substring(cut).trim();
    }

    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
  }


  // ──────────────────────────────────────────────────────────
  // 🏗️ HÀM NỘI BỘ: Fetch một chunk ≤ MAX_CHARS qua Google TTS
  // ──────────────────────────────────────────────────────────
  /**
   * @param {string} text - Đoạn văn bản đã đảm bảo ≤ MAX_CHARS.
   * @returns {Promise<Blob>}
   */
  async function _fetchAudioBlob(text) {
    const safeText  = text.substring(0, MAX_CHARS); // safety net
    const googleUrl = `${GOOGLE_BASE}?client=gtx&ie=UTF-8&tl=vi&q=${encodeURIComponent(safeText)}`;
    const proxyUrl  = `${PROXY_BASE}${encodeURIComponent(googleUrl)}`;

    const response = await fetch(proxyUrl);

    if (!response.ok) {
      throw new Error(
        `[AudioEngine] Proxy thất bại: ${response.status} ${response.statusText}`
      );
    }

    return await response.blob();
  }


  // ──────────────────────────────────────────────────────────
  // 🌐 API CÔNG KHAI: window.generateAudio
  // ──────────────────────────────────────────────────────────
  /**
   * Xử lý văn bản theo nhân cách, chia chunks ≤ MAX_CHARS,
   * tải từng chunk, ghép lại thành 1 Blob duy nhất.
   *
   * @param {string}   text        - Văn bản gốc cần đọc.
   * @param {1|2|3|4}  personaType - Loại nhân cách.
   * @returns {Promise<{
   *   blob: Blob,
   *   playbackRate: number,
   *   preservesPitch: boolean,
   *   personaName: string
   * }>}
   */
  async function generateAudio(text, personaType) {
    const persona = PERSONAS[personaType];

    if (!persona) {
      throw new Error(
        `[AudioEngine] personaType không hợp lệ: ${personaType}. Chỉ nhận 1, 2, 3, 4.`
      );
    }

    if (typeof text !== "string" || text.trim() === "") {
      throw new Error("[AudioEngine] text không được rỗng.");
    }

    // 1️⃣ Áp dụng transform của persona
    const transformedText = persona.transform(text);

    // 2️⃣ Chunk thông minh tại ranh giới từ
    const chunks = _chunkText(transformedText, MAX_CHARS);

    // 3️⃣ Fetch từng chunk → mảng Blob
    const blobs = [];
    for (const chunk of chunks) {
      if (chunk.trim().length === 0) continue;
      const b = await _fetchAudioBlob(chunk);
      blobs.push(b);
    }

    // ✅ FIX V47.2: Throw rõ ràng thay vì trả Blob rỗng
    if (blobs.length === 0) {
      throw new Error(
        "[AudioEngine] Không tải được audio nào. Kiểm tra proxy hoặc text đầu vào."
      );
    }

    // 4️⃣ Ghép tất cả chunk thành 1 Blob duy nhất
    const finalBlob = new Blob(blobs, { type: "audio/mpeg" });

    return {
      blob          : finalBlob,
      playbackRate  : persona.playbackRate,
      preservesPitch: persona.preservesPitch,
      personaName   : persona.name,
    };
  }


  // ──────────────────────────────────────────────────────────
  // 🩹 ADAPTER: generateAudioBlob — Raw Blob (tương thích index.html)
  // ──────────────────────────────────────────────────────────
  /**
   * @param {string}  text    - Văn bản gốc.
   * @param {1|2|3|4} voiceId - Mã nhân cách.
   * @returns {Promise<Blob>}
   */
  async function generateAudioBlob(text, voiceId) {
    const result = await generateAudio(text, voiceId);
    return result.blob;
  }


  // ──────────────────────────────────────────────────────────
  // 🔗 Gắn vào window (hoặc export nếu dùng module)
  // ──────────────────────────────────────────────────────────
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { generateAudio, generateAudioBlob };
  } else {
    global.generateAudio     = generateAudio;
    global.generateAudioBlob = generateAudioBlob;
  }

})(typeof globalThis !== "undefined" ? globalThis : window);


// ============================================================
//  📖 GHI CHÚ TÍCH HỢP
// ============================================================
//
//  <script src="AudioEngine.js"></script>
//
//  ─── CÁCH 1 (ghép Blob tổng — index.html đang dùng) ───────
//    const b = await window.generateAudioBlob(seg.text, seg.voiceId);
//    blobs.push(b);
//    const finalBlob = new Blob(blobs, { type: 'audio/mpeg' });
//    // ⚠️ playbackRate / preservesPitch KHÔNG áp dụng khi ghép chung
//
//  ─── CÁCH 2 (phát tuần tự — giữ Micro-Shift từng đoạn) ───
//    const result = await window.generateAudio(seg.text, seg.voiceId);
//    const url    = URL.createObjectURL(result.blob);
//    const audio  = new Audio(url);
//    audio.playbackRate   = result.playbackRate;
//    audio.preservesPitch = result.preservesPitch;
//    await audio.play();
//    URL.revokeObjectURL(url); // ← dọn ngay sau khi phát xong
//
//  CHANGELOG V47.2:
//    • Persona 4: đọc text thật + hesitation ngẫu nhiên (À/Ừm/À ừm)
//    • Persona 2: playbackRate 0.90 → 0.96 (nam, tự nhiên hơn)
//    • Persona 3: playbackRate 0.82 → 0.89 (trung tính, tự nhiên hơn)
//    • _chunkText: guard -1 từ .search() tường minh hơn
//    • generateAudio: throw khi blobs rỗng thay vì trả Blob rỗng
// ============================================================
