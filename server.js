// server.js - Backend AI checker dùng Gemini (CommonJS)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
app.use(express.json());

// CORS
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Khởi tạo Gemini
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY chưa được thiết lập!");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Model mới, rẻ & nhanh
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

/* ==================== RULE NGÔN TỪ CẤM ==================== */

const forbiddenConfig = {
  facebook: [
    {
      pattern: /giảm cân cấp tốc/gi,
      reason: "Cam kết kết quả quá mức, dễ vi phạm chính sách nền tảng.",
      suggestion: "Dùng 'hỗ trợ kiểm soát cân nặng lành mạnh, khoa học'.",
    },
    {
      pattern: /100% khỏi bệnh/gi,
      reason: "Khẳng định tuyệt đối về hiệu quả điều trị.",
      suggestion: "Dùng 'hỗ trợ điều trị', 'giảm nguy cơ'…",
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
        type: "forbidden",
        original: m[0],
        level: "warning",
        reason: rule.reason,
        suggestion: rule.suggestion,
      });
    }
  }
  return warnings;
}

/* ==================== THÔNG TIN BẮT BUỘC CỐ ĐỊNH ==================== */
// Bạn chỉnh sửa list này theo công ty mình

const requiredConfig = {
  facebook: {
    requiredBranches: ["Cờ Vua Sài Gòn"],
    requiredHotlines: [],
  },
  website: {
    requiredBranches: ["Cờ Vua Sài Gòn"],
    requiredHotlines: [],
  },
  tiktok: {
    requiredBranches: [],
    requiredHotlines: [],
  },
};

function checkRequired(text, platform) {
  const cfg = requiredConfig[platform] || {};
  const warnings = [];
  const contentLower = text.toLowerCase();

  (cfg.requiredBranches || []).forEach((branch) => {
    if (!contentLower.includes(branch.toLowerCase())) {
      warnings.push({
        type: "missing_branch",
        level: "warning",
        message: `Bài viết chưa nhắc đến chi nhánh / thương hiệu: "${branch}"`,
      });
    }
  });

  (cfg.requiredHotlines || []).forEach((phone) => {
    if (!text.includes(phone)) {
      warnings.push({
        type: "missing_hotline",
        level: "warning",
        message: `Bài viết chưa có hotline: ${phone}`,
      });
    }
  });

  return warnings;
}

/* ==================== YÊU CẦU DO NGƯỜI DÙNG NHẬP ==================== */

function checkDynamicRequirements(text, requirementsRaw) {
  if (!requirementsRaw) return [];

  const lines = requirementsRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const contentLower = text.toLowerCase();
  const warnings = [];

  lines.forEach((req) => {
    const cleanReq = req.replace(/^[-•+]/, "").trim();
    if (!cleanReq) return;

    if (!contentLower.includes(cleanReq.toLowerCase())) {
      warnings.push({
        type: "missing_requirement",
        level: "warning",
        requirement: cleanReq,
        message: `Bài viết chưa đáp ứng yêu cầu: "${cleanReq}"`,
      });
    }
  });

  return warnings;
}

/* ==================== ROUTES ==================== */

app.get("/", (req, res) => {
  res.send("Backend Gemini hoạt động!");
});

app.post("/api/check", async (req, res) => {
  try {
    const { text, platform = "facebook", requirements } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Vui lòng gửi nội dung text" });
    }

    const forbiddenWarnings = checkForbidden(text, platform);
    const requiredWarnings = checkRequired(text, platform);
    const dynamicReqWarnings = checkDynamicRequirements(text, requirements);

    const prompt = `
Bạn là trợ lý biên tập nội dung tiếng Việt cho doanh nghiệp.

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
      const firstBrace = rawText.indexOf("{");
      const lastBrace = rawText.lastIndexOf("}");
      const jsonString =
        firstBrace !== -1 && lastBrace !== -1
          ? rawText.slice(firstBrace, lastBrace + 1)
          : rawText;

      aiData = JSON.parse(jsonString);
    } catch (e) {
      console.error("Không parse được JSON từ Gemini:", rawText);
      aiData = {
        corrected_text: text,
        spelling_issues: [],
        general_suggestions: [
          "Gemini không trả về JSON hợp lệ, vui lòng thử lại sau.",
        ],
      };
    }

    res.json({
      corrected_text: aiData.corrected_text || text,
      spelling_issues: aiData.spelling_issues || [],
      general_suggestions: aiData.general_suggestions || [],
      forbidden_warnings: forbiddenWarnings,
      required_warnings: requiredWarnings,
      dynamic_requirements: dynamicReqWarnings,
    });
  } catch (err) {
    console.error("LỖI GEMINI:", err?.message || err);
    res.status(500).json({
      error: "Gemini error",
      detail: err?.message || "Unknown error",
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Server Gemini đang chạy ở port", port);
});
