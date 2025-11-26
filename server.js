// server.js - Backend AI checker dùng Gemini (CommonJS)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
app.use(express.json());

// CORS cho frontend
app.use(
  cors({
    origin: "*", // sau này có thể đổi thành 'https://covuasaigon.edu.vn'
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ===== Khởi tạo Gemini =====
if (!process.env.GEMINI_API_KEY) {
  console.error("⚠️  GEMINI_API_KEY chưa được thiết lập trong env!");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Model nhanh & tiết kiệm
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

/* ============ 1. RULE NGÔN TỪ CẤM / NHẠY CẢM ============ */

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

/* ============ 2. CẤU HÌNH THÔNG TIN CÔNG TY ============ */
/* Anh/chị chỉnh list này cho đúng với trung tâm mình */

const companyConfig = {
  brandNames: ["Cờ Vua Sài Gòn", "Co Vua Sai Gon"],
  branches: [
    "CN Phú Nhuận",
    "CN Quận 12",
    "CN Gò Vấp",
    // thêm nếu có
  ],
  hotlines: [
    "0938 123 456",
    "0909 888 999",
    // ...
  ],
  slogans: [
    "Nơi trẻ em lớn lên cùng quân cờ",
    "Tư duy logic – trưởng thành cùng cờ vua",
    // slogan khác...
  ],
  services: [
    "lớp cờ",
    "lớp học cờ",
    "khóa học cờ",
    "khóa học online",
    // ...
  ],
};

// selected = { brand: true, branch: false, ... }
function checkCompanyRequirements(text, selected = {}) {
  const warnings = [];
  const lower = text.toLowerCase();

  if (selected.brand) {
    const hasBrand = companyConfig.brandNames.some((b) =>
      lower.includes(b.toLowerCase())
    );
    if (!hasBrand) {
      warnings.push({
        type: "missing_brand",
        level: "warning",
        message: "Bài viết chưa nhắc đến tên thương hiệu (Cờ Vua Sài Gòn).",
      });
    }
  }

  if (selected.branch) {
    const hasBranch = companyConfig.branches.some((b) =>
      lower.includes(b.toLowerCase())
    );
    if (!hasBranch) {
      warnings.push({
        type: "missing_branch",
        level: "warning",
        message: "Bài viết chưa có tên chi nhánh nào.",
      });
    }
  }

  if (selected.hotline) {
    const hasHotline = companyConfig.hotlines.some((h) => text.includes(h));
    if (!hasHotline) {
      warnings.push({
        type: "missing_hotline",
        level: "warning",
        message: "Bài viết chưa có hotline chính của trung tâm.",
      });
    }
  }

  if (selected.slogan) {
    const hasSlogan = companyConfig.slogans.some((s) =>
      lower.includes(s.toLowerCase())
    );
    if (!hasSlogan) {
      warnings.push({
        type: "missing_slogan",
        level: "warning",
        message: "Bài viết chưa có câu slogan của trung tâm.",
      });
    }
  }

  if (selected.service) {
    const hasService = companyConfig.services.some((s) =>
      lower.includes(s.toLowerCase())
    );
    if (!hasService) {
      warnings.push({
        type: "missing_service",
        level: "warning",
        message: "Bài viết chưa nhắc tới dịch vụ / khóa học cờ vua.",
      });
    }
  }

  return warnings;
}

/* ============ 3. YÊU CẦU CHECKLIST TỰ NHẬP (TEXT / CSV) ============ */

function checkDynamicRequirements(text, requirementsRaw) {
  if (!requirementsRaw) return [];
  const lines = requirementsRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const lower = text.toLowerCase();
  const warnings = [];

  lines.forEach((req) => {
    const cleanReq = req.replace(/^[-•+]/, "").trim();
    if (!cleanReq) return;
    if (!lower.includes(cleanReq.toLowerCase())) {
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
    const {
      text,
      platform = "facebook",
      requirementsText,
      selectedChecks = {},
    } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Vui lòng gửi nội dung text" });
    }

    const forbiddenWarnings = checkForbidden(text, platform);
    const companyWarnings = checkCompanyRequirements(text, selectedChecks);
    const dynamicReqWarnings = checkDynamicRequirements(text, requirementsText);

    const prompt = `
Bạn là trợ lý biên tập nội dung tiếng Việt dành cho trung tâm giáo dục cho trẻ 3–15 tuổi.

💡 YÊU CẦU VĂN PHONG:
- Thân thiện, gần gũi với trẻ và phụ huynh.
- Tích cực, truyền cảm hứng.
- Tuyệt đối không dùng từ thô tục, tiêu cực hoặc gây hoang mang.
- Không sử dụng lời lẽ “đe dọa” hoặc gây áp lực như: kém cỏi, thất bại, dốt, yếu kém,...
- Không đưa ra cam kết 100% hoặc khẳng định kết quả.

🎯 NHIỆM VỤ CỦA BẠN:
1. Sửa chính tả, dấu câu, ngữ pháp và giúp bài viết trở nên thân thiện – lịch sự – phù hợp phụ huynh.
2. Giữ nguyên ý chính, chỉ chỉnh lại cho rõ ràng, dễ đọc, phù hợp môi trường giáo dục trẻ.
3. Liệt kê rõ các lỗi chính tả đã sửa (original, correct, reason).
4. Đưa ra tối đa 5 gợi ý để cải thiện nội dung theo hướng thân thiện và phù hợp trẻ.
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
      company_warnings: companyWarnings,
      dynamic_requirements: dynamicReqWarnings,
    });
  } catch (err) {
    console.error("🔥 LỖI GEMINI:", err?.message || err);
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
