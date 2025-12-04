// server.js - AI Checker backend (Gemini hoặc Ollama)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ===== CẤU HÌNH NHÀ CUNG CẤP MODEL =====
const MODEL_PROVIDER = (process.env.MODEL_PROVIDER || "gemini").toLowerCase();

// GEMINI: dùng GEMINI_API_KEY + GEMINI_MODEL (tuỳ chọn)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";

// OLLAMA: chạy local, ví dụ: ollama pull qwen2.5:7b
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

const app = express();

// ===== CORS =====
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(cors());
app.use(express.json({ limit: "10mb" })); // cho image base64

// ======================================================
// 1. HÀM GỌI GEMINI
// ======================================================
async function callGemini(prompt, imageBase64) {
  if (!GEMINI_API_KEY) {
    throw new Error("Thiếu GEMINI_API_KEY trong biến môi trường.");
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  // Nếu có ảnh => gửi multimodal
  if (imageBase64) {
    const imagePart = {
      inlineData: {
        data: imageBase64.split(",")[1], // bỏ "data:image/png;base64,"
        mimeType: "image/png",
      },
    };

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }, imagePart],
        },
      ],
    });

    return result.response.text().trim();
  }

  // Text-only
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

// ======================================================
// 2. HÀM GỌI OLLAMA LOCAL
// ======================================================
async function callOllama(prompt) {
  const body = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
  };

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
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

// ======================================================
// 3. HÀM GỌI MODEL CHUNG
// ======================================================
async function callModel(prompt, opts = {}) {
  const { imageBase64 } = opts || {};

  if (MODEL_PROVIDER === "ollama") {
    // Ollama hiện chỉ dùng text (không image)
    return callOllama(prompt);
  }
  return callGemini(prompt, imageBase64);
}

// ======================================================
// 4. RULE NGÔN TỪ CẤM / NHẠY CẢM
// ======================================================
const forbiddenConfig = {
  facebook: [
    {
      pattern: /giảm cân cấp tốc/gi,
      reason: "Cam kết kết quả quá mức, dễ vi phạm chính sách nền tảng.",
      suggestion: "Dùng 'hỗ trợ kiểm soát cân nặng lành mạnh, khoa học'.",
    },
    {
      pattern: /100%\s*(khỏi|hiệu quả|bảo đảm|đảm bảo)/gi,
      reason: "Không nên hứa hẹn kết quả 100% trong nội dung giáo dục / sức khoẻ.",
      suggestion: "Dùng 'tối ưu', 'hỗ trợ', 'tăng cơ hội' thay vì 100%.",
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

// ======================================================
// 5. RULE THÔNG TIN CÔNG TY
// ======================================================
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
    pattern: /(08[0-9]{8}|09[0-9]{7,8}|hotline|điện thoại liên hệ)/i,
    message: "Nên có hotline / số điện thoại để phụ huynh liên hệ.",
  },
  slogan: {
    pattern: /(tư duy logic|khơi gợi sáng tạo|cùng con lớn lên|slogan)/i,
    message:
      "Có thể thêm câu slogan / thông điệp thương hiệu để bài viết ấn tượng hơn.",
  },
  service: {
    pattern:
      /(lớp cờ vua|khóa học cờ vua|lớp vẽ|khóa học vẽ|chương trình học|lớp nghệ thuật)/i,
    message:
      "Nên nhắc rõ dịch vụ: lớp cờ vua, lớp vẽ hoặc chương trình học cụ thể.",
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

// ======================================================
// 6. YÊU CẦU CUSTOM (CHECKLIST TỪ TEXT/FILE)
// ======================================================
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

// ======================================================
// 7. FOOTER CỜ VUA / VẼ
// ======================================================
const CHESS_FOOTER = [
  "📍 HỆ THỐNG TRUNG TÂM CỜ VUA SÀI GÒN (SGC)",
  "☎️ Hotline: 0845.700.135",
  "🌐 Website: covuasaigon.edu.vn",
  "📌 Fanpage: facebook.com/covuasaigon.edu.vn",
  "🏠 N13, Khu Golden Mansion, 119 Phổ Quang – Phú Nhuận – TP.HCM",
  "🏡 17 cơ sở: TP Thủ Đức (Thủ Đức, Quận 9, Quận 2), Bình Thạnh, Phú Nhuận, Gò Vấp, Tân Bình, Tân Phú, Bình Tân, Quận 10",
];

const ART_FOOTER = [
  "🎨 HỆ THỐNG TRUNG TÂM SAI GON ART",
  "📞 Hotline: 084 502 0038",
  "🌐 Website: saigonart.edu.vn",
  "📍 Trụ sở chính: N13, Đường N, Phổ Quang, Phú Nhuận, TP.HCM",
  "🏫 Hệ thống 17 cơ sở tại: TP Thủ Đức (Thủ Đức, Quận 9, Quận 2), Bình Thạnh, Phú Nhuận, Gò Vấp, Tân Bình, Tân Phú, Bình Tân, Quận 10",
];

function needsFooter(text, footerLines) {
  if (!text) return true;
  const lower = text.toLowerCase();
  return !footerLines.some((line) =>
    lower.includes(line.toLowerCase().slice(0, 10))
  );
}

function appendFooters(rewriteText, platformText) {
  let result = rewriteText || "";
  const useChess = /cờ vua|cờ vua sài gòn|covuasaigon/i.test(platformText);
  const useArt = /vẽ|saigon art|saigonart/i.test(platformText);

  const footerParts = [];

  if (useChess && needsFooter(result, CHESS_FOOTER)) {
    footerParts.push(CHESS_FOOTER.join("\n"));
  }
  if (useArt && needsFooter(result, ART_FOOTER)) {
    footerParts.push(ART_FOOTER.join("\n"));
  }

  if (!footerParts.length) return result;

  if (result && !result.endsWith("\n")) result += "\n\n";
  result += footerParts.join("\n\n");
  return result;
}

// ======================================================
// 8. PROMPT TEXT
// ======================================================
function buildTextPrompt(text) {
  return `
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

QUY ĐỊNH QUAN TRỌNG:
- KHÔNG dùng markdown đậm/nhạt như **text**, __text__, # tiêu đề...
- Có thể dùng icon bullet như: "📌", "✨", "🎨", "🧠", "♟️", "👉", "•".
- Không được trả về văn bản thuần, chỉ trả về JSON.

CHỈ TRẢ VỀ DUY NHẤT MỘT ĐỐI TƯỢNG JSON VỚI CẤU TRÚC:

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
}

// ======================================================
// 9. PROMPT IMAGE – có góp ý bố cục, màu sắc
// ======================================================
function buildImagePrompt() {
  return `
Bạn là chuyên gia nội dung VÀ thiết kế poster cho một trung tâm dạy Cờ vua & Vẽ cho trẻ từ 3–15 tuổi.

ẢNH ĐÃ ĐÍNH KÈM: là poster/banner truyền thông trên Facebook/website.

PHẦN 1 – ĐỌC NỘI DUNG:
1. Đọc toàn bộ chữ xuất hiện trên hình, chép lại thành một đoạn plain_text (giống như gõ lại nội dung chữ trên hình).

PHẦN 2 – XỬ LÝ NỘI DUNG (DỰA TRÊN plain_text):
2. Sửa chính tả, dấu câu, ngữ pháp (trả về "corrected_text").
3. Liệt kê "spelling_issues" (mỗi lỗi có original, correct, reason ngắn gọn).
4. Gợi ý "general_suggestions" (tối đa 5 gợi ý, tập trung vào:
   - Làm rõ thông điệp chính,
   - Call-to-action cho phụ huynh,
   - Bố cục nội dung chữ trên poster dễ hiểu hơn).
5. Gợi ý 5–12 "hashtags" phù hợp (không dấu, bắt đầu bằng #).
6. Viết lại bài thân thiện với phụ huynh ("rewrite_text"), có thể bỏ bớt các dòng thừa trên poster nhưng giữ đủ thông tin quan trọng.

PHẦN 3 – NHẬN XÉT THIẾT KẾ ("design_feedback"):
Hãy trả về mảng "design_feedback" (tối đa 5 gợi ý), mỗi phần tử là 1 câu góp ý rõ ràng, tập trung vào:

- BỐ CỤC:
  + Các khối nội dung có cân đối trái/phải/trên/dưới không?
  + Tiêu đề chính có nổi bật và dễ nhìn không?
  + Khoảng cách giữa các dòng, các block có bị quá sát hoặc quá xa không?
  + Có nên gom nhóm hoặc đổi vị trí một số phần để mắt người xem đi theo thứ tự dễ hiểu hơn không?

- MÀU SẮC:
  + Màu nền và màu chữ có đủ tương phản để đọc dễ không?
  + Tông màu đang dùng có hài hoà, phù hợp trẻ em và phụ huynh không?
  + Có khu vực nào quá chói hoặc quá tối làm người xem mỏi mắt không?
  + Gợi ý 1–2 hướng phối màu (ví dụ: nền sáng + 1–2 màu chủ đạo).

- CHUYÊN MÔN KHÁC:
  + Font chữ có thống nhất, dễ đọc với trẻ em và phụ huynh không?
  + Có dùng quá nhiều kiểu chữ/hiệu ứng (shadow, outline, gradient) gây rối không?
  + Logo, hotline, thông tin quan trọng có đủ nổi bật nhưng không che khuất nội dung khác không?
  + Gợi ý cụ thể để nâng cấp poster lên phiên bản tốt hơn (giản lược text, tăng khoảng trắng, thêm icon minh hoạ, v.v.).

QUY ĐỊNH VỀ ĐỊNH DẠNG:
- KHÔNG dùng markdown như **đậm**, __, #, * trong "corrected_text" hoặc "rewrite_text".
- Có thể dùng icon bullet: "📌", "✨", "🎨", "🧠", "♟️", "👉", "•".
- Không tự chèn JSON lồng nhau, chỉ trả về đúng một đối tượng JSON.

FOOTER THÔNG TIN TRUNG TÂM:
- Áp dụng cùng quy tắc footer như bài text: nếu poster chưa có thông tin đầy đủ thì thêm vào cuối "rewrite_text".

CHỈ TRẢ VỀ MỘT ĐỐI TƯỢNG JSON CÓ CẤU TRÚC:

{
  "plain_text": "...",
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
  "rewrite_text": "...",
  "design_feedback": [
    "..."
  ]
}
`;
}

// ======================================================
// 10. ROUTES
// ======================================================
app.get("/", (req, res) => {
  res.send(
    `Backend AI Checker đang chạy với provider=${MODEL_PROVIDER.toUpperCase()}`
  );
});

// ---------- /api/check (TEXT) ----------
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

    // 1. Check rule cứng
    const forbiddenWarnings = checkForbidden(text, platform);
    const companyWarnings = checkCompanyInfo(text, selectedChecks);
    const dynamicList = parseRequirementsText(requirementsText);
    const dynamicWarnings = checkDynamicRequirements(text, dynamicList);

    // 2. Gọi AI
    const prompt = buildTextPrompt(text);
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

    let correctedText = aiData.corrected_text || text;
    const spellingIssues = aiData.spelling_issues || [];
    const generalSuggestions = aiData.general_suggestions || [];
    const hashtags = aiData.hashtags || [];
    let rewriteText = aiData.rewrite_text || correctedText;

    // Footer
    rewriteText = appendFooters(rewriteText, text);

    // 3. TÍNH ĐIỂM
    let score = 100;
    const spellCount = spellingIssues.length;
    const forbidCount = forbiddenWarnings.length;
    const companyCount = companyWarnings.length;
    const dynamicCount = dynamicWarnings.length;

    score -= Math.min(spellCount * 5, 30);
    score -= Math.min(forbidCount * 15, 45);
    score -= Math.min(companyCount * 8, 24);
    score -= Math.min(dynamicCount * 5, 25);
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

// ---------- /api/check-image (IMAGE) ----------
app.post("/api/check-image", async (req, res) => {
  try {
    const {
      imageBase64,
      platform = "facebook",
      requirementsText = "",
      selectedChecks = {},
    } = req.body;

    if (!imageBase64) {
      return res
        .status(400)
        .json({ error: "Vui lòng gửi imageBase64 của poster." });
    }

    // Đầu tiên, cho AI đọc + xử lý nội dung poster
    const prompt = buildImagePrompt();
    const rawText = await callModel(prompt, { imageBase64 });

    let aiData;
    try {
      aiData = JSON.parse(rawText);
    } catch (e) {
      console.error("Không parse được JSON (image):", rawText);
      aiData = {
        plain_text: "",
        corrected_text: "",
        spelling_issues: [],
        general_suggestions: [
          "Model không trả về JSON hợp lệ khi phân tích hình ảnh.",
        ],
        hashtags: [],
        rewrite_text: "",
        design_feedback: [],
      };
    }

    const plainText = aiData.plain_text || "";
    const baseText = plainText || aiData.corrected_text || "";

    // Check rule cứng dựa trên text đã đọc được
    const forbiddenWarnings = checkForbidden(baseText, platform);
    const companyWarnings = checkCompanyInfo(baseText, selectedChecks);
    const dynamicList = parseRequirementsText(requirementsText);
    const dynamicWarnings = checkDynamicRequirements(baseText, dynamicList);

    const spellingIssues = aiData.spelling_issues || [];
    const generalSuggestions = aiData.general_suggestions || [];
    const hashtags = aiData.hashtags || [];
    const designFeedback = aiData.design_feedback || [];

    let correctedText = aiData.corrected_text || baseText;
    let rewriteText = aiData.rewrite_text || correctedText;

    // Footer cho rewrite
    rewriteText = appendFooters(rewriteText, baseText);

    // TÍNH ĐIỂM
    let score = 100;
    const spellCount = spellingIssues.length;
    const forbidCount = forbiddenWarnings.length;
    const companyCount = companyWarnings.length;
    const dynamicCount = dynamicWarnings.length;

    score -= Math.min(spellCount * 5, 30);
    score -= Math.min(forbidCount * 15, 45);
    score -= Math.min(companyCount * 8, 24);
    score -= Math.min(dynamicCount * 5, 25);
    if (score < 0) score = 0;

    let grade = "A";
    if (score < 65) grade = "C";
    else if (score < 85) grade = "B";

    const scoreReason = [
      `Lỗi chính tả trên poster: ${spellCount}`,
      `Từ cấm / nhạy cảm: ${forbidCount}`,
      `Thiếu thông tin công ty: ${companyCount}`,
      `Thiếu yêu cầu custom: ${dynamicCount}`,
    ].join(" · ");

    res.json({
      provider: MODEL_PROVIDER,
      plain_text: plainText,
      corrected_text: correctedText,
      spelling_issues: spellingIssues,
      general_suggestions: generalSuggestions,
      hashtags,
      rewrite_text: rewriteText,
      design_feedback: designFeedback,

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

// ======================================================
// 11. START SERVER
// ======================================================
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(
    `Server AI Checker đang chạy ở port ${port} với provider=${MODEL_PROVIDER.toUpperCase()}`
  );
});
