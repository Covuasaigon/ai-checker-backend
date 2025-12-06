// server.js - Backend AI Checker (TEXT + IMAGE, Gemini)

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ===== CẤU HÌNH GEMINI =====
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

if (!GEMINI_API_KEY) {
  console.warn("⚠️ Thiếu GEMINI_API_KEY trong biến môi trường!");
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

// ===== EXPRESS APP =====
const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" })); // để nhận base64 image

// ===================================================================
// 1. CÁC RULE/CHECKLIST BACKEND (KHÔNG TỐN AI)
// ===================================================================

// Từ/cụm từ nên tránh theo từng platform
const forbiddenConfig = {
  facebook: [
    {
      pattern: /giảm cân cấp tốc/gi,
      reason: "Cam kết kết quả quá mức, dễ vi phạm chính sách nền tảng.",
      suggestion: "Dùng 'hỗ trợ kiểm soát cân nặng lành mạnh, khoa học'.",
    },
    {
      pattern: /100% khỏi bệnh/gi,
      reason: "Khẳng định tuyệt đối về sức khỏe.",
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

// Checklist thông tin công ty (Cờ Vua Sài Gòn / Sai Gon Art)
const companyChecks = {
  brand: {
    pattern: /(cờ vua sài gòn|covuasaigon\.edu\.vn|sai gon art|saigonart\.edu\.vn)/i,
    message: 'Nên nhắc đến tên trung tâm "Cờ Vua Sài Gòn" hoặc "Sai Gon Art" / domain.',
  },
  branch: {
    pattern: /(chi nhánh|cơ sở|campus|cs[0-9]+)/i,
    message:
      "Nên ghi ít nhất một chi nhánh / cơ sở để phụ huynh biết địa điểm.",
  },
  hotline: {
    pattern: /(0845\.?700\.?135|084\s?502\s?0038|hotline|điện thoại liên hệ)/i,
    message: "Nên có hotline / số điện thoại để phụ huynh liên hệ.",
  },
  slogan: {
    pattern: /(tư duy logic|khơi gợi sáng tạo|cùng con lớn lên|slogan)/i,
    message:
      "Có thể thêm câu slogan / thông điệp thương hiệu để bài viết ấn tượng hơn.",
  },
  service: {
    pattern:
      /(lớp cờ vua|khóa học cờ vua|lớp vẽ|khóa học vẽ|chương trình học|mầm non)/i,
    message:
      "Nên nhắc rõ dịch vụ: lớp cờ vua, lớp vẽ hoặc chương trình học cho bé.",
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

// YÊU CẦU CUSTOM (nhập tay + file)
function parseRequirementsText(raw) {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function checkDynamicRequirements(text, requirements) {
  const lower = (text || "").toLowerCase();
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

// ===================================================================
// 2. TÍNH ĐIỂM A/B/C Ở BACKEND
// ===================================================================
function computeScore({
  spellingCount,
  forbidCount,
  companyCount,
  dynamicCount,
}) {
  let score = 100;
  score -= Math.min(spellingCount * 5, 30); // tối đa -30 điểm chính tả
  score -= Math.min(forbidCount * 15, 45); // từ cấm nặng hơn
  score -= Math.min(companyCount * 8, 24); // thiếu thông tin công ty
  score -= Math.min(dynamicCount * 5, 25); // thiếu yêu cầu custom

  if (score < 0) score = 0;

  let grade = "A";
  if (score < 65) grade = "C";
  else if (score < 85) grade = "B";

  const scoreReason = [
    `Lỗi chính tả: ${spellingCount}`,
    `Từ cấm / nhạy cảm: ${forbidCount}`,
    `Thiếu thông tin công ty: ${companyCount}`,
    `Thiếu yêu cầu custom: ${dynamicCount}`,
  ].join(" · ");

  return { score, grade, scoreReason };
}

// ===================================================================
// 3. PROMPT TEXT
// ===================================================================
function buildTextPrompt(text) {
  return `
Bạn là trợ lý biên tập nội dung tiếng Việt cho một trung tâm dạy Cờ vua & Vẽ cho trẻ từ 3–15 tuổi.
Đối tượng chính là phụ huynh, giọng văn cần:
- Thân thiện, tích cực, tôn trọng phụ huynh và các bé
- Không dùng từ thô tục, không miệt thị, không phân biệt
- Không hứa hẹn cam kết kết quả tuyệt đối 100%
- Phù hợp cho môi trường giáo dục, an toàn cho trẻ em

QUY ĐỊNH VỀ ĐỊNH DẠNG:
- KHÔNG dùng markdown kiểu **đậm**, __, #, * hoặc các ký hiệu markdown tương tự.
- Nếu muốn làm nổi bật ý, hãy dùng icon/bullet phù hợp, ví dụ:
  "📌", "✨", "🎨", "🧠", "♟️", "👉", "•"...
- Mỗi ý chính nên nằm trên một dòng riêng, có thể bắt đầu bằng icon đó.
- Không tự ý chèn code, JSON hoặc chú thích kỹ thuật vào nội dung bài viết.

NHIỆM VỤ:
1. Sửa chính tả, dấu câu, ngữ pháp cho bài viết, giữ nguyên ý chính.
2. Liệt kê các lỗi chính tả đã sửa (mỗi lỗi gồm: original, correct, reason ngắn gọn).
3. Đưa ra gợi ý tối ưu nội dung (tối đa 5 gợi ý, dạng câu ngắn dễ hiểu).
4. Gợi ý từ 5–12 hashtag phù hợp cho bài viết về Cờ vua / Vẽ / giáo dục trẻ em (không có dấu, bắt đầu bằng #).
5. Viết lại toàn bộ bài theo phong cách:
   - Vui tươi, ấm áp, khích lệ các bé
   - Lịch sự, dễ hiểu cho phụ huynh
   - Không thay đổi thông tin sự kiện / chương trình
   - Có thể dùng các icon bullet như đã nêu ở trên để bài viết sinh động hơn.

6. FOOTER THÔNG TIN TRUNG TÂM (CHỈ THÊM VÀO "rewrite_text"):
   - Sau khi viết lại nội dung chính, nếu trong bài gốc hoặc bản viết lại KHÔNG chứa hotline
     "0845.700.135" hoặc "084 502 0038", hãy tự động THÊM MỘT trong hai footer chuẩn dưới đây
     vào cuối đoạn "rewrite_text", cách phần nội dung phía trên bằng một dòng trống.

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
   - Nếu nội dung chủ yếu nói về "vẽ, hội họa, mỹ thuật, art, tranh" => dùng [FOOTER_VE].
   - Nếu bài nói về CẢ HAI (vừa cờ vua vừa vẽ) => dùng CẢ HAI footer, trong đó [FOOTER_COVUA] viết trước.
   - Nếu nội dung không rõ ràng, mặc định dùng [FOOTER_COVUA].
   - Nếu trong bài gốc đã có đủ các thông tin trong footer (hotline, website, địa chỉ),
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
}

// ===================================================================
// 4. PROMPT IMAGE (OCR + DESIGN FEEDBACK)
// ===================================================================
function buildImagePrompt() {
  return `
Bạn là chuyên gia:
- Thiết kế đồ hoạ (poster/brochure/banner Facebook),
- Biên tập nội dung tiếng Việt,
- Kiểm duyệt hình ảnh truyền thông cho trung tâm dạy Cờ Vua & Vẽ cho trẻ em.

ẢNH ĐÍNH KÈM: là poster quảng cáo.
Hãy phân tích thật chính xác TỪNG CHỮ trên ảnh và KHÔNG tự bịa nội dung.

===========================
PHẦN 1 — OCR: ĐỌC CHỮ TRÊN ẢNH (plain_text)
===========================
1. Đọc TẤT CẢ chữ xuất hiện trong poster (dù lớn hay nhỏ).
2. Chép lại giống 100% như ảnh (không sửa lỗi ở bước này).
3. Nếu chữ bị thiếu dấu tiếng Việt (ví dụ: "tuyen sinh"), vẫn ghi đúng những gì bạn đọc được.

Trả về trong trường "plain_text".

===========================
PHẦN 2 — XỬ LÝ NỘI DUNG (corrected_text)
===========================
- Sửa chính tả, dấu câu, ngữ pháp.
- Đặc biệt chú ý trường hợp thiếu dấu tiếng Việt (mầm non → mầm non, tuyen sinh → tuyển sinh…).
- Trả về nội dung sau khi sửa trong "corrected_text".
- Liệt kê các lỗi trong "spelling_issues": mỗi lỗi có "original", "correct", "reason".
- "general_suggestions": tối đa 5 gợi ý để tối ưu nội dung poster (rõ thông điệp, CTA, rút gọn câu dài).

===========================
PHẦN 3 — NHẬN XÉT THIẾT KẾ (design_feedback)
===========================
Hãy trả về mảng "design_feedback" (tối đa 5 gợi ý), tập trung vào:
- Bố cục: cân đối trái/phải/trên/dưới, khoảng cách, thứ tự đọc.
- Màu sắc: độ tương phản chữ–nền, tông màu có hài hoà, phù hợp trẻ em.
- Font & đồ hoạ: số lượng font, hiệu ứng, logo/hotline có đủ nổi bật không.
- Gợi ý cụ thể để nâng cấp poster (rút gọn text, tăng khoảng trắng, thêm icon minh hoạ…).

===========================
PHẦN 4 — HASHTAG & VIẾT LẠI (tùy chọn)
===========================
- "hashtags": mảng 5–12 hashtag không dấu, bắt đầu bằng #, liên quan cờ vua / vẽ / giáo dục.
- "rewrite_text": nếu có thể, viết lại nội dung chữ chính của poster theo phong cách thân thiện với phụ huynh (không bắt buộc phải có).

⚠️ CHỈ TRẢ VỀ DUY NHẤT ĐỐI TƯỢNG JSON VỚI CẤU TRÚC:

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

// ===================================================================
// 5. HELPER CHUẨN HOÁ DỮ LIỆU TRẢ VỀ
// ===================================================================
function normalizeResponse(obj, fallbackText = "") {
  const data = obj || {};
  return {
    plain_text: data.plain_text || "",
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

// ===================================================================
// 6. ROUTE: CHECK TEXT
// ===================================================================
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

    // 1. Check rule cứng ở backend
    const forbiddenWarnings = checkForbidden(text, platform);
    const companyWarnings = checkCompanyInfo(text, selectedChecks);
    const dynamicList = parseRequirementsText(requirementsText);
    const dynamicWarnings = checkDynamicRequirements(text, dynamicList);

    // 2. Gọi Gemini với output JSON
    const prompt = buildTextPrompt(text);

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    });

    let parsed;
    try {
      const raw = result.response.text();
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("❌ Lỗi parse JSON (TEXT):", e.message);
      parsed = {
        corrected_text: text,
        spelling_issues: [],
        general_suggestions: ["Model không trả về JSON hợp lệ (TEXT)."],
        hashtags: [],
        rewrite_text: text,
      };
    }

    // 3. Gắn thêm các cảnh báo backend
    parsed.forbidden_warnings = forbiddenWarnings;
    parsed.company_warnings = companyWarnings;
    parsed.dynamic_requirements = dynamicWarnings;

    // 4. Tính điểm
    const spellingCount = (parsed.spelling_issues || []).length;
    const forbidCount = forbiddenWarnings.length;
    const companyCount = companyWarnings.length;
    const dynamicCount = dynamicWarnings.length;

    const { score, grade, scoreReason } = computeScore({
      spellingCount,
      forbidCount,
      companyCount,
      dynamicCount,
    });

    parsed.score = score;
    parsed.grade = grade;
    parsed.score_reason = scoreReason;

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

// ===================================================================
// 7. ROUTE: CHECK IMAGE
// ===================================================================
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

    // Tách header dataURL
    let mimeType = "image/png";
    let base64Data = imageBase64;

    const m = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (m) {
      mimeType = m[1];
      base64Data = m[2];
    }

    const prompt = buildImagePrompt();

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
      generationConfig: { responseMimeType: "application/json" },
    });

    let parsed;
    try {
      const raw = result.response.text();
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("❌ Lỗi parse JSON (IMAGE):", e.message);
      parsed = {
        plain_text: "",
        corrected_text: "",
        spelling_issues: [],
        general_suggestions: ["Model không trả về JSON hợp lệ cho hình ảnh."],
        design_feedback: [],
        hashtags: [],
        rewrite_text: "",
      };
    }

    // Text nền để check rule backend (ưu tiên corrected_text)
    const baseText =
      parsed.corrected_text || parsed.plain_text || "";

    const forbiddenWarnings = checkForbidden(baseText, platform);
    const companyWarnings = checkCompanyInfo(baseText, selectedChecks);
    const dynamicList = parseRequirementsText(requirementsText);
    const dynamicWarnings = checkDynamicRequirements(baseText, dynamicList);

    parsed.forbidden_warnings = forbiddenWarnings;
    parsed.company_warnings = companyWarnings;
    parsed.dynamic_requirements = dynamicWarnings;

    // Tính điểm
    const spellingCount = (parsed.spelling_issues || []).length;
    const forbidCount = forbiddenWarnings.length;
    const companyCount = companyWarnings.length;
    const dynamicCount = dynamicWarnings.length;

    const { score, grade, scoreReason } = computeScore({
      spellingCount,
      forbidCount,
      companyCount,
      dynamicCount,
    });

    parsed.score = score;
    parsed.grade = grade;
    parsed.score_reason = scoreReason;

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

// ===================================================================
// 8. ROOT & START SERVER
// ===================================================================
app.get("/", (req, res) => {
  res.send("AI Checker backend is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ AI Checker backend đang chạy tại port ${PORT}`);
});
