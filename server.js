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
Bạn là trợ lý biên tập nội dung cho TRUNG TÂM CỜ VUA & VẼ thiếu nhi.
Hãy xử lý bài viết tiếng Việt dưới đây theo yêu cầu.

NGỮ CẢNH:
- Nền tảng: ${platform}
- Checklist cố định (bật/tắt): ${checksStr}
- Checklist tùy chỉnh (mỗi dòng là một yêu cầu):
"""${reqStr}"""

YÊU CẦU:
1. Sửa toàn bộ lỗi chính tả, dấu câu, ngữ pháp. Giữ nguyên ý chính.
2. Liệt kê đầy đủ các lỗi chính tả đã sửa: { original, correct, reason }.
3. Kiểm tra NGÔN TỪ NHẠY CẢM / TỪ CẤM, đặc biệt:
   - xúc phạm, miệt thị, thô tục
   - hứa hẹn kết quả tuyệt đối 100%
   - claim y khoa không an toàn
   Trả về mảng forbidden_warnings: { original, reason, suggestion }.
4. Kiểm tra checklist CỐ ĐỊNH theo các key:
   brand, branch, hotline, slogan, service.
   - Nếu bài CHƯA đáp ứng, thêm vào company_warnings:
     { message: "..." } với lời nhắc rõ ràng, lịch sự.
5. Kiểm tra checklist TÙY CHỈNH (requirementsText – mỗi dòng một yêu cầu).
   - Mỗi yêu cầu chưa được đề cập -> dynamic_requirements:
     { message: "Bài viết chưa đáp ứng yêu cầu: \\"...\\""}
6. Đề xuất tối đa 7 gợi ý tối ưu nội dung: general_suggestions (mảng string).
7. Gợi ý từ 5–12 hashtag phù hợp cho trung tâm dạy CỜ VUA, VẼ, GIÁO DỤC TRẺ EM.
8. Viết lại toàn bộ bài theo phong cách:
   - Vui tươi, ấm áp, khích lệ các bé
   - Lịch sự, dễ hiểu cho phụ huynh
   - Không dùng từ thô tục, không miệt thị, không cam kết 100%
   -> ghi vào rewrite_text.
9. Tự chấm điểm:
   - score: 0–100
   - grade: "A" | "B" | "C" (A >= 85, B 65–84, C < 65)
   - score_reason: giải thích ngắn gọn dựa trên chính tả, từ cấm, checklist.

CHỈ TRẢ VỀ DUY NHẤT MỘT ĐỐI TƯỢNG JSON VỚI CẤU TRÚC CHÍNH XÁC:

{
  "corrected_text": "...",
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
  "hashtags": [
    "#..."
  ],
  "rewrite_text": "...",
  "score": 0,
  "grade": "A",
  "score_reason": "..."
}

Nếu không có mục nào, trả về mảng rỗng [] cho mục đó.

BÀI VIẾT GỐC:
"""${text}"""
`;
}

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
