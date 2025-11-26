// server.js dùng Gemini (CommonJS)
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
app.use(express.json());

// CORS thủ công cho tất cả domain (covuasaigon.edu.vn, v.v.)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // nếu sau này muốn chặt hơn thì đổi * thành domain của bạn
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Khởi tạo Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ========= RULE RIÊNG DOANH NGHIỆP =========
const forbiddenConfig = {
  facebook: [
    {
      pattern: /giảm cân cấp tốc/gi,
      reason: "Cam kết kết quả quá mức, dễ vi phạm chính sách nền tảng.",
      suggestion: "Dùng 'hỗ trợ kiểm soát cân nặng lành mạnh, khoa học'.",
    },
    {
      pattern: /100% khỏi bệnh/gi,
      reason: "Khẳng định tuyệt đối về sức khoẻ.",
      suggestion: "Dùng 'giảm nguy cơ', 'hỗ trợ điều trị'…",
    },
  ],
  website: [
    {
      pattern: /sốc/gi,
      reason: "Ngôn từ giật gân, không phù hợp website chính thức.",
      suggestion: "Dùng ngôn từ trung tính, chuyên nghiệp hơn.",
    },
  ],
  tiktok: [],
};

function checkForbidden(text, platform) {
  const rules = forbiddenConfig[platform] || [];
  const warnings = [];

  for (const rule of rules) {
    let m;
    while ((m = rule.pattern.exec(text)) !== null) {
      warnings.push({
        original: m[0],
        level: "warning",
        reason: rule.reason,
        suggestion: rule.suggestion,
      });
    }
  }

  return warnings;
}

// Test route
app.get("/", (req, res) => {
  res.send("Backend Gemini hoạt động!");
});

// API chính
app.post("/api/check", async (req, res) => {
  try {
    const { text, platform = "facebook" } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Vui lòng gửi nội dung text" });
    }

    const baseWarnings = checkForbidden(text, platform);

    const prompt = `
Bạn là trợ lý biên tập nội dung tiếng Việt cho doanh nghiệp.

Bối cảnh doanh nghiệp:
- Là trung tâm / doanh nghiệp dịch vụ, cần ngôn từ lịch sự, chuẩn mực.
- Không dùng từ thô tục, không phân biệt, không cam kết kết quả 100%.
- Xưng hô thân thiện, tôn trọng khách hàng.

NHIỆM VỤ:
1. Sửa chính tả, dấu câu, ngữ pháp cho bài viết.
2. Giữ nguyên ý chính, chỉ chỉnh cho rõ ràng, mạch lạc, chuyên nghiệp.
3. Liệt kê các lỗi chính tả bạn đã sửa (original, correct, reason).
4. Gợi ý chung để nội dung phù hợp hơn với môi trường doanh nghiệp (tối đa 5 gợi ý).
5. CHỈ TRẢ VỀ DƯỚI DẠNG JSON, THEO FORMAT:

{
  "corrected_text": "...",
  "spelling_issues": [
    { "original": "...", "correct": "...", "reason": "..." }
  ],
  "general_suggestions": [
    "..."
  ]
}

BÀI GỐC:
"""${text}"""
`;

    const result = await model.generateContent(prompt);
    const rawText = result.response.text();

    let aiData;
    try {
      aiData = JSON.parse(rawText);
    } catch (e) {
      console.error("Không parse được JSON từ Gemini:", rawText);
      aiData = {
        corrected_text: text,
        spelling_issues: [],
        general_suggestions: ["Gemini không trả về JSON hợp lệ, vui lòng thử lại."],
      };
    }

    res.json({
      corrected_text: aiData.corrected_text || text,
      spelling_issues: aiData.spelling_issues || [],
      general_suggestions: aiData.general_suggestions || [],
      forbidden_warnings: baseWarnings,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Có lỗi khi xử lý với Gemini" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Server Gemini đang chạy ở port", port);
});
