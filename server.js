// ===============================
//  AI Checker Backend (FULL NEW) 
// ===============================

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());
app.use(cors());

// ===============================
// CONFIG – TÙY CHỌN MODEL
// ===============================
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// ===============================
// HÀM GỌI GEMINI
// ===============================
async function callGemini(prompt) {
  if (!GEMINI_KEY) throw new Error("Thiếu GEMINI_API_KEY");

  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

// ===============================
// API CHECK
// ===============================
app.post("/api/check", async (req, res) => {
  try {
    const text = req.body.text || "";

    const prompt = `
Bạn là AI chuyên sửa chính tả tiếng Việt & biên tập nội dung cho Trung tâm Cờ Vua – Vẽ dành cho trẻ em.

YÊU CẦU:
1. Sửa toàn bộ lỗi chính tả.
2. Liệt kê từng lỗi chính tả (từ sai → từ đúng).
3. Viết lại bài thân thiện với PH.
4. Gợi ý 5–12 hashtag phù hợp.
5. Không được thay đổi ý nghĩa.
6. TRẢ VỀ DUY NHẤT JSON:

{
 "corrected_text": "...",
 "spelling_issues": [
     {"original": "...", "correct": "..."}
 ],
 "suggestions": ["..."],
 "hashtags": ["#..."],
 "rewrite_text": "..."
}

DÙ DÀI HAY NGẮN VẪN PHẢI TRẢ ĐỦ JSON.

BÀI GỐC:
"""${text}"""
`;

    const raw = await callGemini(prompt);

    // TRÁNH LỖI MODEL TRẢ KHÔNG ĐÚNG JSON
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = {
        corrected_text: text,
        spelling_issues: [],
        suggestions: ["Model trả về JSON sai định dạng."],
        hashtags: [],
        rewrite_text: text,
      };
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===============================
app.listen(process.env.PORT || 3000, () =>
  console.log("AI Checker backend running...")
);
