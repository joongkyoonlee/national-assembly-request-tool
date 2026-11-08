const { apply, FlowError } = require("../web/flow.js");
const org = require("./org.json");

const EMPTY_DB = () => ({ cases: [], log: [] });

function createBlobStore() {
  return {
    async load() {
      const { head } = require("@vercel/blob");
      try {
        const blob = await head("cases.json", { token: process.env.BLOB_READ_WRITE_TOKEN });
        const downloadUrl = new URL(blob.downloadUrl);
        downloadUrl.searchParams.set("v", Date.now().toString());
        const response = await fetch(downloadUrl, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" }
        });
        if (!response.ok) throw new Error(`cases.json 조회 실패: ${response.status}`);
        return await response.json();
      } catch (error) {
        if (error && (
          error.name === "BlobNotFoundError" ||
          error.constructor?.name === "BlobNotFoundError" ||
          error.status === 404 || error.statusCode === 404 ||
          /requested blob does not exist/i.test(error.message || "")
        )) return EMPTY_DB();
        throw error;
      }
    },

    async save(db) {
      const { put } = require("@vercel/blob");
      await put("cases.json", JSON.stringify(db, null, 2), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
        contentType: "application/json; charset=utf-8",
        token: process.env.BLOB_READ_WRITE_TOKEN
      });
    }
  };
}

function send(res, status, body) {
  return res.status(status).json(body);
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function callOpenAI(requirement, apiKey = process.env.OPENAI_API_KEY) {
  if (!apiKey) throw new ApiError(500, "OPENAI_API_KEY 환경변수가 설정되지 않아 AI 추천을 사용할 수 없음");
  const departments = org.map((item) => item.과);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `국회 요구자료의 소관 과를 추천한다. 반드시 JSON으로만 답한다. 허용 과 목록 안에서 최대 3개를 고르고 각 근거는 한국어 1문장으로 쓴다. 맞는 과가 없으면 후보는 빈 배열, 해당없음은 true로 답한다. 형식: {"후보":[{"과":"과명","근거":"1문장"}],"해당없음":false}. 허용 과: ${departments.join(", ")}`
        },
        { role: "user", content: requirement }
      ]
    })
  });
  let body;
  try { body = await response.json(); } catch (_) { body = {}; }
  if (!response.ok) {
    throw new ApiError(502, `OpenAI API 호출에 실패함${body.error?.message ? `: ${body.error.message}` : ""}`);
  }
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new ApiError(502, "OpenAI API 응답에 추천 JSON이 없음");
  try { return JSON.parse(content); } catch (_) { throw new ApiError(502, "OpenAI API 추천 JSON을 해석할 수 없음"); }
}

function normalizeRecommendation(raw) {
  const allowed = new Set(org.map((item) => item.과));
  if (raw && raw.해당없음 === true) return { 후보: [], 해당없음: true };
  const candidates = [];
  const seen = new Set();
  for (const item of Array.isArray(raw?.후보) ? raw.후보 : []) {
    const department = typeof item?.과 === "string" ? item.과.trim() : "";
    const reason = typeof item?.근거 === "string" ? item.근거.replace(/\s+/g, " ").trim() : "";
    if (!allowed.has(department) || !reason || seen.has(department)) continue;
    candidates.push({ 과: department, 근거: reason });
    seen.add(department);
    if (candidates.length === 3) break;
  }
  return { 후보: candidates, 해당없음: candidates.length === 0 };
}

function createHandler(store = createBlobStore(), dependencies = {}) {
  const recommend = dependencies.callOpenAI || callOpenAI;
  return async function handler(req, res) {
    try {
      if (req.method === "GET") return send(res, 200, await store.load());
      if (req.method !== "POST") {
        if (typeof res.setHeader === "function") res.setHeader("Allow", "GET, POST");
        return send(res, 405, { error: "GET과 POST만 지원함" });
      }

      const request = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (request?.작업 === "AI추천") {
        const requirement = typeof request.요구내용 === "string" ? request.요구내용.trim() : "";
        if (!requirement) return send(res, 400, { error: "AI추천 요구내용은 필수임" });
        return send(res, 200, normalizeRecommendation(await recommend(requirement)));
      }
      const db = await store.load();
      const result = apply(db, request, org);
      await store.save(db);
      return send(res, 200, result);
    } catch (error) {
      if (error instanceof SyntaxError) return send(res, 400, { error: "JSON 요청 형식이 올바르지 않음" });
      if (error instanceof FlowError) return send(res, error.status, { error: error.message });
      if (error instanceof ApiError) return send(res, error.status, { error: error.message });
      console.error(error);
      return send(res, 500, { error: "서버 저장소 처리에 실패함" });
    }
  };
}

const handler = createHandler();
module.exports = handler;
module.exports.createHandler = createHandler;
module.exports.createBlobStore = createBlobStore;
module.exports.callOpenAI = callOpenAI;
module.exports.normalizeRecommendation = normalizeRecommendation;
