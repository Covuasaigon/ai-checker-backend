// server.js – Backend cho AI Checker (text + image)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ===== CẤU HÌNH GEMINI =====
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!GEMINI_API_KEY) {
  console.warn("⚠️ Thiếu GEMINI_API_KEY trong biến môi trường!");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" })); // để nhận base64 image

// ===== HELPER: bóc JSON từ output của model =====
function extractJson(text) {
  if (!text) throw new Error("Model không trả về nội dung.");

  // Nếu Gemini bọc trong ```json ... ```
  const fence =
    text.match(/```json([\s\S]*?)```/i) ||
    text.match(/```([\s\S]*?)```/i);

  const jsonStr = (fence ? fence[1] : text).trim();
  return JSON.parse(jsonStr);
}

// ===== HELPER: build prompt chung cho TEXT =====
function buildTextPrompt({ text, platform, requirementsText, selectedChecks }) {
  const checksStr = JSON.stringify(selectedChecks || {});
  const reqStr = requirementsText || "";

  return `


Bạn là trợ lý biên tập nội dung tiếng Việt cho một trung tâm dạy Cờ vua & Vẽ cho trẻ từ 3–16 tuổi.
Đối tượng chính là phụ huynh, giọng văn cần:
- Thân thiện, tích cực, tôn trọng phụ huynh và các bé
- Không dùng từ thô tục, không miệt thị, không phân biệt
- Không hứa hẹn cam kết kết quả tuyệt đối 100%
- Phù hợp cho môi trường giáo dục, an toàn cho trẻ em

NHIỆM VỤ:
1. Sửa chính tả, dấu câu, ngữ pháp cho bài viết, giữ nguyên ý chính.
2. Liệt kê các lỗi chính tả đã sửa.
3. Đưa ra gợi ý tối ưu nội dung (tối đa 5 gợi ý).
4. Gợi ý từ 5–12 hashtag phù hợp cho bài viết về Cờ vua / Vẽ / giáo dục trẻ em.
5. Viết lại toàn bộ bài theo phong cách:
   - Vui tươi, ấm áp, khích lệ các bé
   - Lịch sự, dễ hiểu cho phụ huynh
   - Không thay đổi thông tin sự kiện / chương trình
   - KHÔNG sử dụng cú pháp markdown như **đậm**, __, #, *, v.v.
   - Nếu muốn làm nổi bật ý, hãy dùng icon/bullet phù hợp, ví dụ:
     "📌", "✨", "🎨", "🧠", "♟️", "👉", "•"...
   - Mỗi ý chính nên nằm trên một dòng riêng, có thể bắt đầu bằng icon đó.

6. FOOTER THÔNG TIN TRUNG TÂM (CHỈ THÊM VÀO \`rewrite_text\`):
   - Sau khi viết lại nội dung chính, nếu trong bài GỐC hoặc bản viết lại đã KHÔNG chứa hotline
     "0845.700.135" hoặc "084 502 0038", hãy tự động THÊM MỘT trong hai footer chuẩn dưới đây
     vào cuối đoạn \`rewrite_text\`, cách phần nội dung phía trên bằng một dòng trống.

   [FOOTER_COVUA]
   📍 HỆ THỐNG TRUNG TÂM CỜ VUA SÀI GÒN (SGC)
   ☎️ Hotline: 0845.700.135
   🌐 Website: covuasaigon.edu.vn
   📌 Fanpage: facebook.com/covuasaigon.edu.vn
   🏠 N13, Khu Golden Mansion, số 119 Phổ Quang – Phú Nhuận – TP.HCM
   🏡 17 Cơ sở trực thuộc: TP Thủ Đức (Thủ Đức | Quận 9 | Quận 2) | Bình Thạnh | Phú Nhuận | Gò Vấp | Tân Bình | Tân Phú | Bình Tân | Quận 10

   [FOOTER_VE]
   🎨 HỆ THỐNG TRUNG TÂM SAI GON ART
   📞 Hotline: 084 502 0038
   🌐 Website: saigonart.edu.vn
   📍 Trụ sở chính: N13, Đường N, Phổ Quang, Phú Nhuận, HCM
   🏫 Hệ thống 17 cơ sở tại:
   🏙️ TP Thủ Đức (Thủ Đức • Quận 9 • Quận 2)
   🏙️ Bình Thạnh • Phú Nhuận • Gò Vấp
   🏙️ Tân Bình • Tân Phú • Bình Tân • Quận 10

   QUY TẮC CHỌN FOOTER:
   - Nếu nội dung chủ yếu nói về "cờ vua, chess, kỳ thủ, quân cờ, ván cờ" => dùng [FOOTER_COVUA].
   - Nếu nội dung chủ yếu nói về "vẽ, hội hoạ, mỹ thuật, art, tranh" => dùng [FOOTER_VE].
   - Nếu bài nói về CẢ HAI (vừa cờ vua vừa vẽ) => dùng CẢ HAI footer, trong đó [FOOTER_COVUA] viết trước.
   - Nếu nội dung không rõ ràng, mặc định dùng [FOOTER_COVUA].
   - Nếu trong bài gốc đã có đúng những thông tin trong footer (hotline, website, địa chỉ),
     thì KHÔNG thêm footer trùng lặp nữa, nhưng có thể chỉnh lại cho đồng bộ format như trên.

CHỈ TRẢ VỀ DUY NHẤT MỘT ĐỐI TƯỢNG JSON VỚI CẤU TRÚC CHÍNH XÁC:

{
  "corrected_text": "...",
  "spelling_issues": [
    { "original": "...", "correct": "...", "reason": "..." }
  ],
  "general_suggestions": [
    "..."
  ],
  "hashtags": [
    "#..."
  ],
  "rewrite_text": "..."
}

Nếu không có lỗi chính tả, trả về "spelling_issues": [].
Nếu không có gợi ý, trả về "general_suggestions": [].
Nếu không cần hashtag, vẫn trả về "hashtags": [].

BÀI GỐC:
"""${text}"""
`;



// ===== HELPER: build prompt cho IMAGE =====
function buildImagePrompt({
  platform,
  requirementsText,
  selectedChecks,
}) {
  const checksStr = JSON.stringify(selectedChecks || {});
  const reqStr = requirementsText || "";

  return `
Bạn là trợ lý kiểm tra POSTER / BANNER cho TRUNG TÂM CỜ VUA & VẼ thiếu nhi.

NHIỆM VỤ:
1. ĐỌC TOÀN BỘ CHỮ TRÊN HÌNH (tiếng Việt). Xem như đó là "bài viết poster".
2. Thực hiện hoàn toàn giống như yêu cầu đối với bài viết TEXT:
   - sửa chính tả, liệt kê lỗi (spelling_issues)
   - forbidden_warnings (từ nhạy cảm, claim quá đà)
   - company_warnings (thiếu brand/chi nhánh/hotline/slogan/service)
   - dynamic_requirements (thiếu yêu cầu tùy chỉnh)
   - general_suggestions (về nội dung, call-to-action,...)
   - hashtags, rewrite_text, score, grade, score_reason
3. Riêng với POSTER, bổ sung thêm mảng "design_feedback":
   - Tối đa 5 gợi ý về bố cục, màu sắc, font chữ, mức độ dễ đọc...
   - Ví dụ: "Tiêu đề nên đậm hơn", "Tránh dùng quá nhiều font", v.v.

NGỮ CẢNH:
- Nền tảng: ${platform}
- Checklist cố định (bật/tắt): ${checksStr}
- Checklist tùy chỉnh (mỗi dòng là một yêu cầu):
"""${reqStr}"""

CHỈ TRẢ VỀ JSON:

{
  "corrected_text": "...",          // phiên bản text đã sửa của nội dung trên poster
  "spelling_issues": [
    { "original": "...", "correct": "...", "reason": "..." }
  ],
  "forbidden_warnings": [
    { "original": "...", "reason": "...", "suggestion": "..." }
  ],
  "company_warnings": [
    { "message": "..." }
  ],
  "dynamic_requirements": [
    { "message": "..." }
  ],
  "general_suggestions": [
    "..."
  ],
  "design_feedback": [
    "..."
  ],
  "hashtags": [
    "#..."
  ],
  "rewrite_text": "...",
  "score": 0,
  "grade": "A",
  "score_reason": "..."
}

Không giải thích thêm. Không kèm text ngoài JSON.
`;
}

// ===== HELPER: chuẩn hoá dữ liệu trả về (đảm bảo luôn có đủ field) =====
function normalizeResponse(obj, fallbackText = "") {
  const data = obj || {};
  return {
    corrected_text: data.corrected_text || fallbackText,
    spelling_issues: data.spelling_issues || [],
    forbidden_warnings: data.forbidden_warnings || [],
    company_warnings: data.company_warnings || [],
    dynamic_requirements: data.dynamic_requirements || [],
    general_suggestions: data.general_suggestions || [],
    design_feedback: data.design_feedback || [],
    hashtags: data.hashtags || [],
    rewrite_text: data.rewrite_text || fallbackText,
    score: typeof data.score === "number" ? data.score : null,
    grade: data.grade || null,
    score_reason: data.score_reason || "",
  };
}

// ===== ROUTE: CHECK TEXT =====
app.post("/api/check", async (req, res) => {
  try {
    const {
      text,
      platform = "facebook",
      requirementsText = "",
      selectedChecks = {},
    } = req.body || {};

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Vui lòng gửi nội dung text." });
    }

    const prompt = buildTextPrompt({
      text,
      platform,
      requirementsText,
      selectedChecks,
    });

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (e) {
      console.error("❌ Lỗi parse JSON (TEXT):", e.message);
      console.error("RAW:", raw);
      // fallback đơn giản
      parsed = {
        corrected_text: text,
        spelling_issues: [],
        forbidden_warnings: [],
        company_warnings: [],
        dynamic_requirements: [],
        general_suggestions: ["Model không trả về JSON hợp lệ."],
        hashtags: [],
        rewrite_text: text,
        score: null,
        grade: null,
        score_reason: "",
      };
    }

    const data = normalizeResponse(parsed, text);
    res.json(data);
  } catch (err) {
    console.error("LỖI /api/check:", err);
    res.status(500).json({
      error: "Có lỗi khi xử lý với AI (TEXT).",
      detail: err.message || String(err),
    });
  }
});

// ===== ROUTE: CHECK IMAGE =====
app.post("/api/check-image", async (req, res) => {
  try {
    const {
      imageBase64,
      platform = "facebook",
      requirementsText = "",
      selectedChecks = {},
    } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: "Thiếu imageBase64." });
    }

    // tách header dataURL
    let mimeType = "image/png";
    let base64Data = imageBase64;

    const m = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (m) {
      mimeType = m[1];
      base64Data = m[2];
    }

    const prompt = buildImagePrompt({
      platform,
      requirementsText,
      selectedChecks,
    });

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
    });

    const raw = result.response.text().trim();

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch (e) {
      console.error("❌ Lỗi parse JSON (IMAGE):", e.message);
      console.error("RAW:", raw);
      parsed = {
        corrected_text: "",
        spelling_issues: [],
        forbidden_warnings: [],
        company_warnings: [],
        dynamic_requirements: [],
        general_suggestions: ["Model không trả về JSON hợp lệ cho hình ảnh."],
        design_feedback: [],
        hashtags: [],
        rewrite_text: "",
        score: null,
        grade: null,
        score_reason: "",
      };
    }

    const data = normalizeResponse(parsed, "");
    res.json(data);
  } catch (err) {
    console.error("LỖI /api/check-image:", err);
    res.status(500).json({
      error: "Có lỗi khi xử lý với AI (IMAGE).",
      detail: err.message || String(err),
    });
  }
});

// ===== ROOT =====
app.get("/", (req, res) => {
  res.send("AI Checker backend is running.");
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ AI Checker backend đang chạy tại port ${PORT}`);
});
