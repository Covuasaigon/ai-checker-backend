// server.js - AI Checker cho trung tâm Cờ vua & Vẽ
// Hỗ trợ 2 chế độ MODEL_PROVIDER = "gemini" (cloud) hoặc "ollama" (local)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ===== CẤU HÌNH NHÀ CUNG CẤP MODEL =====
const MODEL_PROVIDER = (process.env.MODEL_PROVIDER || "gemini").toLowerCase();

// GEMINI: dùng GEMINI_API_KEY + GEMINI_MODEL (tuỳ chọn)
// Gợi ý: GEMINI_MODEL = gemini-1.5-flash-latest (ổn định, rẻ)
// OLLAMA: dùng OLLAMA_URL (default http://127.0.0.1:11434) + OLLAMA_MODEL (vd: "qwen2.5:7b")
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

const app = express();

// CORS cho mọi domain
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

// ======= HÀM GỌI GEMINI (TEXT) =======
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

// ======= HÀM GỌI GEMINI (IMAGE) =======
async function callGeminiWithImage(prompt, base64Data, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Thiếu GEMINI_API_KEY trong .env");
  }

  const modelName =
    process.env.GEMINI_MODEL || "gemini-1.5-flash-latest";

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const imagePart = {
    inlineData: {
      data: base64Data,
      mimeType: mimeType || "image/png",
    },
  };

  const result = await model.generateContent([
    { text: prompt },
    imagePart,
  ]);
  const rawText = result.response.text().trim();
  return rawText;
}

// ======= HÀM GỌI OLLAMA LOCAL (TEXT) =======
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
  return (data.response || "").trim();
}

// ======= HÀM GỌI MODEL CHUNG (TEXT) =======
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
    pattern:
      /(lớp cờ vua|khóa học cờ vua|lớp vẽ|khóa học vẽ|chương trình học)/i,
    message:
      "Nên nhắc rõ dịch vụ: lớp cờ vua, lớp vẽ hoặc chương trình học.",
  },
};

function checkCompanyInfo(text, selectedChecks = {}) {
  const warnings = [];
  for (const key of Object.keys(companyChecks)) {
    if (!selectedChecks[key]) continue;
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

// ===== TÍNH ĐIỂM =====
function computeScore({
  spellingIssues,
  forbiddenWarnings,
  companyWarnings,
  dynamicWarnings,
}) {
  let score = 100;
  const spellCount = spellingIssues.length;
  const forbidCount = forbiddenWarnings.length;
  const companyCount = companyWarnings.length;
  const dynamicCount = dynamicWarnings.length;

  score -= Math.min(spellCount * 5, 30); // tối đa -30 điểm chính tả
  score -= Math.min(forbidCount * 15, 45); // từ cấm nặng hơn
  score -= Math.min(companyCount * 8, 24); // thiếu thông tin công ty
  score -= Math.min(dynamicCount * 5, 25); // thiếu yêu cầu custom

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

  return { score, grade, scoreReason };
}

// ===== ROUTES =====
app.get("/", (req, res) => {
  res.send(
    `Backend AI Checker đang chạy với provider=${MODEL_PROVIDER.toUpperCase()}`
  );
});

// ---------- 1) API CHECK TEXT ----------
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

    const dynamicList = parseRequirementsText(requirementsText);

    const checklistLines = [];
    if (selectedChecks.brand) {
      checklistLines.push(
        "- Có nhắc đến tên trung tâm (ví dụ: Cờ Vua Sài Gòn hoặc covuasaigon.edu.vn)."
      );
    }
    if (selectedChecks.branch) {
      checklistLines.push(
        "- Có nhắc đến ít nhất một chi nhánh / cơ sở cụ thể."
      );
    }
    if (selectedChecks.hotline) {
      checklistLines.push(
        "- Có ghi rõ hotline / số điện thoại liên hệ của trung tâm."
      );
    }
    if (selectedChecks.slogan) {
      checklistLines.push(
        "- Có thêm một câu slogan hoặc thông điệp thương hiệu ngắn gọn."
      );
    }
    if (selectedChecks.service) {
      checklistLines.push(
        "- Có nhắc rõ dịch vụ: lớp cờ vua, lớp vẽ hoặc chương trình học."
      );
    }
    dynamicList.forEach((reqLine) => {
      checklistLines.push(`- ${reqLine}`);
    });

    const checklistTextForModel =
      checklistLines.length > 0
        ? checklistLines.join("\n")
        : "- Không có yêu cầu bổ sung đặc biệt.";

    const prompt = `
Bạn là trợ lý biên tập nội dung tiếng Việt cho một trung tâm dạy Cờ vua & Vẽ cho trẻ từ 3–15 tuổi.
Đối tượng chính là phụ huynh, giọng văn cần:
- Thân thiện, tích cực, tôn trọng phụ huynh và các bé
- Không dùng từ thô tục, không miệt thị, không phân biệt
- Không hứa hẹn cam kết kết quả tuyệt đối 100%
- Phù hợp cho môi trường giáo dục, an toàn cho trẻ em

CHECKLIST BẮT BUỘC (hãy đảm bảo phiên bản "corrected_text" đã đáp ứng đầy đủ;
nếu bài gốc chưa có, bạn được phép thêm 1–2 câu ngắn gọn, lịch sự để bổ sung):
${checklistTextForModel}

NHIỆM VỤ:
1. Sửa chính tả, dấu câu, ngữ pháp cho bài viết, giữ nguyên ý chính.
2. Khi cần, hãy KHÉO LÉO BỔ SUNG các thông tin còn thiếu theo checklist trên (vd: tên trung tâm, hotline, chi nhánh, slogan...) vào "corrected_text".
3. Liệt kê các lỗi chính tả đã sửa.
4. Đưa ra gợi ý tối ưu nội dung (tối đa 5 gợi ý).
5. Gợi ý từ 5–12 hashtag phù hợp cho bài viết về Cờ vua / Vẽ / giáo dục trẻ em.
6. Viết lại toàn bộ bài theo phong cách:
   - Vui tươi, ấm áp, khích lệ các bé
   - Lịch sự, dễ hiểu cho phụ huynh
   - Không thay đổi thông tin sự kiện / chương trình (chỉ chỉnh câu chữ và cách diễn đạt).

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

    // Check rule backend trên bản đã chỉnh sửa
    const forbiddenWarnings = checkForbidden(correctedText, platform);
    const companyWarnings = checkCompanyInfo(correctedText, selectedChecks);
    const dynamicWarnings = checkDynamicRequirements(
      correctedText,
      dynamicList
    );

    const { score, grade, scoreReason } = computeScore({
      spellingIssues,
      forbiddenWarnings,
      companyWarnings,
      dynamicWarnings,
    });

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

// ---------- 2) API CHECK IMAGE ----------
app.post("/api/check-image", async (req, res) => {
  try {
    if (MODEL_PROVIDER !== "gemini") {
      return res.status(400).json({
        error:
          "Chế độ kiểm tra hình ảnh chỉ hỗ trợ khi MODEL_PROVIDER = 'gemini'",
      });
    }

    const {
      imageDataUrl,
      platform = "facebook",
      requirementsText = "",
      selectedChecks = {},
    } = req.body;

    if (!imageDataUrl) {
      return res.status(400).json({ error: "Thiếu imageDataUrl" });
    }

    const match = imageDataUrl.match(/^data:(.+);base64,(.*)$/);
    if (!match) {
      return res
        .status(400)
        .json({ error: "Định dạng imageDataUrl không hợp lệ" });
    }
    const mimeType = match[1];
    const base64Data = match[2];

    const dynamicList = parseRequirementsText(requirementsText);

    const checklistLines = [];
    if (selectedChecks.brand) {
      checklistLines.push(
        "- Có nhắc đến tên trung tâm (ví dụ: Cờ Vua Sài Gòn hoặc covuasaigon.edu.vn)."
      );
    }
    if (selectedChecks.branch) {
      checklistLines.push(
        "- Có nhắc đến ít nhất một chi nhánh / cơ sở cụ thể."
      );
    }
    if (selectedChecks.hotline) {
      checklistLines.push(
        "- Có ghi rõ hotline / số điện thoại liên hệ của trung tâm."
      );
    }
    if (selectedChecks.slogan) {
      checklistLines.push(
        "- Có thêm một câu slogan hoặc thông điệp thương hiệu ngắn gọn."
      );
    }
    if (selectedChecks.service) {
      checklistLines.push(
        "- Có nhắc rõ dịch vụ: lớp cờ vua, lớp vẽ hoặc chương trình học."
      );
    }
    dynamicList.forEach((reqLine) => {
      checklistLines.push(`- ${reqLine}`);
    });

    const checklistTextForModel =
      checklistLines.length > 0
        ? checklistLines.join("\n")
        : "- Không có yêu cầu bổ sung đặc biệt.";

    const prompt = `
Bạn là trợ lý thiết kế & biên tập nội dung cho trung tâm dạy Cờ vua & Vẽ (trẻ 3–15 tuổi).
Bạn được cung cấp một hình ảnh (poster / banner).

BƯỚC 1 – ĐỌC NỘI DUNG TRONG ẢNH:
- Hãy đọc toàn bộ chữ trong ảnh và lưu vào trường "extracted_text".

BƯỚC 2 – CHỈNH SỬA NỘI DUNG:
- Xem "extracted_text" như một bài viết.
- Sửa chính tả, dấu câu, ngữ pháp.
- Có thể viết lại câu cho mượt hơn, nhưng không thay đổi thông tin sự kiện/chương trình.
- Đảm bảo giọng văn thân thiện, phù hợp phụ huynh và trẻ em.

CHECKLIST BẮT BUỘC (hãy cố gắng BỔ SUNG nếu hình chưa có, bằng 1–2 câu ngắn trong "corrected_text"):
${checklistTextForModel}

BƯỚC 3 – ĐÁNH GIÁ THIẾT KẾ:
- Đưa ra góp ý về màu sắc, bố cục, độ tương phản, font chữ,… dành cho designer.
- Ghi vào mảng "design_feedback" (mỗi phần tử là 1 câu khuyến nghị ngắn).

BƯỚC 4 – KẾT QUẢ:
- Trả về JSON duy nhất với cấu trúc:

{
  "extracted_text": "...",
  "corrected_text": "...",
  "spelling_issues": [
    { "original": "...", "correct": "...", "reason": "..." }
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
  "rewrite_text": "..."
}

Nếu không có lỗi chính tả thì "spelling_issues": [].
Nếu không có góp ý, "design_feedback": [].

NHỚ: Chỉ trả về JSON, không kèm giải thích bên ngoài.
`;

    const rawText = await callGeminiWithImage(
      prompt,
      base64Data,
      mimeType
    );

    let aiData;
    try {
      aiData = JSON.parse(rawText);
    } catch (e) {
      console.error("Không parse được JSON từ model (image):", rawText);
      aiData = {
        extracted_text: "",
        corrected_text: "",
        spelling_issues: [],
        general_suggestions: [
          "Model không trả về JSON hợp lệ, vui lòng thử lại sau hoặc dùng ảnh đơn giản hơn.",
        ],
        design_feedback: [],
        hashtags: [],
        rewrite_text: "",
      };
    }

    const extractedText = aiData.extracted_text || "";
    const correctedText =
      aiData.corrected_text || extractedText || "";
    const spellingIssues = aiData.spelling_issues || [];
    const generalSuggestions = aiData.general_suggestions || [];
    const designFeedback = aiData.design_feedback || [];
    const hashtags = aiData.hashtags || [];
    const rewriteText = aiData.rewrite_text || correctedText;

    // Check rule backend trên bản đã chỉnh sửa
    const forbiddenWarnings = checkForbidden(correctedText, platform);
    const companyWarnings = checkCompanyInfo(correctedText, selectedChecks);
    const dynamicWarnings = checkDynamicRequirements(
      correctedText,
      dynamicList
    );

    const { score, grade, scoreReason } = computeScore({
      spellingIssues,
      forbiddenWarnings,
      companyWarnings,
      dynamicWarnings,
    });

    res.json({
      provider: MODEL_PROVIDER,
      extracted_text: extractedText,
      corrected_text: correctedText,
      spelling_issues: spellingIssues,
      general_suggestions: generalSuggestions,
      design_feedback: designFeedback,
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
    console.error("LỖI API /api/check-image:", err);
    res.status(500).json({
      error: "Có lỗi khi xử lý hình ảnh với AI model",
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
