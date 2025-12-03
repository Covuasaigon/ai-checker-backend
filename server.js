// server.js - Hỗ trợ 2 chế độ: GEMINI hoặc OLLAMA (local)
// Chọn bằng biến môi trường MODEL_PROVIDER = "gemini" | "ollama"

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ===== CẤU HÌNH NHÀ CUNG CẤP MODEL =====
const MODEL_PROVIDER = (process.env.MODEL_PROVIDER || "gemini").toLowerCase();
// GEMINI: dùng GEMINI_API_KEY + GEMINI_MODEL (tuỳ chọn)
// OLLAMA: dùng OLLAMA_URL (mặc định http://127.0.0.1:11434) + OLLAMA_MODEL (vd: "qwen2.5:7b")

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

const app = express();

// CORS cho mọi domain (sau này có thể siết lại về domain của trung tâm)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(cors());
app.use(express.json());

// ======= HÀM GỌI GEMINI =======
async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Thiếu GEMINI_API_KEY trong .env");
  }

  const modelName =
    process.env.GEMINI_MODEL || "gemini-2.5-flash";
  

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const result = await model.generateContent(prompt);
  const rawText = result.response.text().trim();
  return rawText;
}

// ======= HÀM GỌI OLLAMA LOCAL =======
// Yêu cầu: chạy ollama + model: "ollama pull qwen2.5:7b" (hoặc model khác)
async function callOllama(prompt) {
  const url = `${OLLAMA_URL}/api/generate`;

  const body = {
    model: OLLAMA_MODEL,
    prompt: prompt,
    stream: false,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  // Ollama thường trả về { response: "...", ... }
  return (data.response || "").trim();
}

// ======= HÀM GỌI MODEL CHUNG =======
async function callModel(prompt) {
  if (MODEL_PROVIDER === "ollama") {
    return callOllama(prompt);
  }
  // mặc định dùng gemini
  return callGemini(prompt);
}

// ===== RULE NGÔN TỪ CẤM / NHẠY CẢM =====
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

// ===== RULE THÔNG TIN CÔNG TY (Cờ Vua Sài Gòn) =====
const companyChecks = {
  brand: {
    pattern: /(cờ vua sài gòn|covuasaigon\.edu\.vn)/i,
    message: 'Nên nhắc đến tên trung tâm "Cờ Vua Sài Gòn" hoặc domain.',
  },
  branch: {
    pattern: /(chi nhánh|cơ sở|campus|cs[0-9]+)/i,
    message:
      "Nên ghi ít nhất một chi nhánh / cơ sở để phụ huynh biết địa điểm.",
  },
  hotline: {
    pattern: /(09[0-9]{7,8}|hotline|điện thoại liên hệ)/i,
    message: "Nên có hotline / số điện thoại để phụ huynh liên hệ.",
  },
  slogan: {
    pattern: /(tư duy logic|khơi gợi sáng tạo|cùng con lớn lên|slogan)/i,
    message:
      "Có thể thêm câu slogan / thông điệp thương hiệu để bài viết ấn tượng hơn.",
  },
  service: {
    pattern: /(lớp cờ vua|khóa học cờ vua|lớp vẽ|khóa học vẽ|chương trình học)/i,
    message: "Nên nhắc rõ dịch vụ: lớp cờ vua, lớp vẽ hoặc chương trình học.",
  },
};

function checkCompanyInfo(text, selectedChecks = {}) {
  const warnings = [];
  for (const key of Object.keys(companyChecks)) {
    if (!selectedChecks[key]) continue; // checkbox nào không chọn thì bỏ qua
    const cfg = companyChecks[key];
    if (!cfg.pattern.test(text)) {
      warnings.push({
        type: key,
        message: cfg.message,
      });
    }
  }
  return warnings;
}

// ===== YÊU CẦU CUSTOM (nhập tay + load file) =====
function parseRequirementsText(raw) {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function checkDynamicRequirements(text, requirements) {
  const lower = text.toLowerCase();
  const warnings = [];
  requirements.forEach((req) => {
    if (!lower.includes(req.toLowerCase())) {
      warnings.push({
        requirement: req,
        message: `Bài viết chưa đáp ứng yêu cầu: "${req}"`,
      });
    }
  });
  return warnings;
}

// ===== ROUTES =====
app.get("/", (req, res) => {
  res.send(
    `Backend AI Checker đang chạy với provider=${MODEL_PROVIDER.toUpperCase()}`
  );
});

app.post("/api/check", async (req, res) => {
  try {
    const {
      text,
      platform = "facebook",
      requirementsText = "",
      selectedChecks = {},
    } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Vui lòng gửi nội dung text" });
    }

    // 1. Check rule cứng ở backend (KHÔNG tốn AI)
    const forbiddenWarnings = checkForbidden(text, platform);
    const companyWarnings = checkCompanyInfo(text, selectedChecks);
    const dynamicList = parseRequirementsText(requirementsText);
    const dynamicWarnings = checkDynamicRequirements(text, dynamicList);

    // 2. Prompt gửi lên model (Gemini / Ollama)
    const prompt = `
Bạn là trợ lý biên tập nội dung tiếng Việt cho một trung tâm dạy Cờ vua & Vẽ cho trẻ từ 3–15 tuổi.
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

    const rawText = await callModel(prompt);

    let aiData;
    try {
      aiData = JSON.parse(rawText);
    } catch (e) {
      console.error("Không parse được JSON từ model:", rawText);
      aiData = {
        corrected_text: text,
        spelling_issues: [],
        general_suggestions: [
          "Model không trả về JSON hợp lệ, vui lòng thử lại sau hoặc rút ngắn bài viết.",
        ],
        hashtags: [],
        rewrite_text: text,
      };
    }

    const correctedText = aiData.corrected_text || text;
    const spellingIssues = aiData.spelling_issues || [];
    const generalSuggestions = aiData.general_suggestions || [];
    const hashtags = aiData.hashtags || [];
    const rewriteText = aiData.rewrite_text || correctedText;

    // 3. TÍNH ĐIỂM A/B/C DỰA TRÊN CHECKLIST (logic backend, không phụ thuộc model)
    let score = 100;
    const spellCount = spellingIssues.length;
    const forbidCount = forbiddenWarnings.length;
    const companyCount = companyWarnings.length;
    const dynamicCount = dynamicWarnings.length;

    score -= Math.min(spellCount * 5, 30);    // tối đa -30 điểm chính tả
    score -= Math.min(forbidCount * 15, 45);  // từ cấm nặng hơn
    score -= Math.min(companyCount * 8, 24);  // thiếu thông tin công ty
    score -= Math.min(dynamicCount * 5, 25);  // thiếu yêu cầu custom

    if (score < 0) score = 0;

    let grade = "A";
    if (score < 65) grade = "C";
    else if (score < 85) grade = "B";

    const scoreReason = [
      `Lỗi chính tả: ${spellCount}`,
      `Từ cấm / nhạy cảm: ${forbidCount}`,
      `Thiếu thông tin công ty: ${companyCount}`,
      `Thiếu yêu cầu custom: ${dynamicCount}`,
    ].join(" · ");

    // 4. Trả về cho frontend
    res.json({
      provider: MODEL_PROVIDER,
      corrected_text: correctedText,
      spelling_issues: spellingIssues,
      general_suggestions: generalSuggestions,
      hashtags,
      rewrite_text: rewriteText,

      forbidden_warnings: forbiddenWarnings,
      company_warnings: companyWarnings,
      dynamic_requirements: dynamicWarnings,

      score,
      grade,
      score_reason: scoreReason,
    });
  } catch (err) {
    console.error("LỖI API /api/check:", err);
    res.status(500).json({
      error: "Có lỗi khi xử lý với AI model",
      detail: err?.message || String(err),
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(
    `Server AI Checker đang chạy ở port ${port} với provider=${MODEL_PROVIDER.toUpperCase()}`
  );
});
