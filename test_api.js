const assert = require("node:assert/strict");
const { createHandler } = require("./api/app.js");

function fakeStore() {
  let data = { cases: [], log: [] };
  return {
    async load() { return structuredClone(data); },
    async save(next) { data = structuredClone(next); },
    inspect() { return structuredClone(data); }
  };
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; }
  };
}

async function call(handler, method, body) {
  const res = response();
  await handler({ method, body }, res);
  return res;
}

async function main() {
  const store = fakeStore();
  const handler = createHandler(store);
  const checks = [];
  const check = async (name, method, body, expected) => {
    const res = await call(handler, method, body);
    assert.equal(res.statusCode, expected, `${name}: ${JSON.stringify(res.body)}`);
    checks.push(`${name} → ${res.statusCode}`);
    return res;
  };

  await check("접수", "POST", {
    작업: "접수", id: "의원C-01", 파일명: "요구서.pdf", 위원회: "행정안전위원회",
    의원: "의원C", 제출기한: "2026-11-10", 문항번호: "1", 요구내용: "AI 사업 실적",
    이름: "버려야 할 값", 연락처: "010-0000-0000", 일시: "2026-11-08T09:00:00.000Z"
  }, 200);
  assert.equal("이름" in store.inspect().cases[0], false);
  assert.equal("연락처" in store.inspect().cases[0], false);

  await check("순서 위반 회신", "POST", {
    작업: "회신", id: "의원C-01", 과: "디지털정책과"
  }, 409);
  await check("조직도 밖 과", "POST", {
    작업: "배분", id: "의원C-01", 주관과: "없는과", 협조과: [], 확정방법: "수정"
  }, 400);
  await check("배분", "POST", {
    작업: "배분", id: "의원C-01", 주관과: "디지털정책과", 협조과: ["운영지원과"],
    확정방법: "규칙", 후보: ["디지털정책과", "운영지원과"], 일시: "2026-11-08T10:00:00.000Z"
  }, 200);
  await check("담당 아닌 과 회신", "POST", {
    작업: "회신", id: "의원C-01", 과: "안전정책과", 파일명: "회신.xlsx"
  }, 403);
  const firstReply = await check("주관과 회신", "POST", {
    작업: "회신", id: "의원C-01", 과: "디지털정책과", 파일명: "회신_디지털.xlsx",
    행: [{ 연도: 2026, 이름: "버려야 할 값", 연락처: "010-0000-0000" }],
    일시: "2026-11-08T11:00:00.000Z"
  }, 200);
  assert.equal(firstReply.body.상태, "회신중");
  assert.deepEqual(firstReply.body.case["과별 회신"].디지털정책과.행, [{ 연도: 2026 }]);
  const lastReply = await check("협조과 회신", "POST", {
    작업: "회신", id: "의원C-01", 과: "운영지원과", 파일명: "회신_운영.xlsx",
    행: [{ 연도: 2026 }], 일시: "2026-11-08T11:30:00.000Z"
  }, 200);
  assert.equal(lastReply.body.상태, "회신완료");

  await check("두 번째 문항 접수", "POST", {
    작업: "접수", id: "의원C-02", 요구내용: "조직 현황"
  }, 200);
  await check("두 번째 문항 배분", "POST", {
    작업: "배분", id: "의원C-02", 주관과: "혁신행정담당관", 협조과: [], 확정방법: "AI"
  }, 200);
  await check("재배정 사유 누락", "POST", {
    작업: "재배정요청", id: "의원C-02", 과: "혁신행정담당관", 희망과: "운영지원과"
  }, 400);
  const reassignment = await check("재배정요청", "POST", {
    작업: "재배정요청", id: "의원C-02", 과: "혁신행정담당관", 사유: "인사 업무에 해당",
    희망과: "운영지원과", 일시: "2026-11-08T12:00:00.000Z"
  }, 200);
  assert.equal(reassignment.body.상태, "재배정요청");

  const get = await check("전체 조회", "GET", undefined, 200);
  assert.equal(get.body.cases.length, 2);
  assert.equal(get.body.log.length, 7);

  const supplement = await check("보완요청", "POST", {
    작업: "보완요청", id: "의원C-01", 과: "디지털정책과", 사유: "예산 초과 사유 보완"
  }, 200);
  assert.equal(supplement.body.상태, "보완요청");
  await check("보완 대상 아닌 과 회신", "POST", {
    작업: "회신", id: "의원C-01", 과: "운영지원과", 파일명: "잘못된_보완.xlsx"
  }, 403);
  const supplemented = await check("보완 대상 과 재회신", "POST", {
    작업: "회신", id: "의원C-01", 과: "디지털정책과", 파일명: "보완_회신.xlsx", 확인필요: []
  }, 200);
  assert.equal(supplemented.body.상태, "회신완료");
  await check("확정 코멘트 누락", "POST", { 작업: "확정", id: "의원C-01" }, 400);
  const confirmed = await check("확정", "POST", { 작업: "확정", id: "의원C-01", 코멘트: "확인필요 조치 완료" }, 200);
  assert.equal(confirmed.body.상태, "확정");

  const fakeResponses = [
    { 후보: [
      { 과: "디지털정책과", 근거: "AI 행정 도입 업무를 담당합니다." },
      { 과: "없는과", 근거: "조직도 밖 후보입니다." },
      { 과: "정보화담당관", 근거: "정보시스템 운영과 관련됩니다." },
      { 과: "데이터정책과", 근거: "데이터 정책과 관련됩니다." },
      { 과: "정보보호과", 근거: "네 번째 허용 후보입니다." }
    ], 해당없음: false },
    { 후보: [{ 과: "디지털정책과", 근거: "무시되어야 합니다." }], 해당없음: true },
    { 후보: [{ 과: "가짜부서", 근거: "조직도에 없습니다." }], 해당없음: false }
  ];
  const aiHandler = createHandler(store, { callOpenAI: async () => fakeResponses.shift() });
  const aiNormal = await checkWith(aiHandler, "AI추천 정상·필터", { 작업: "AI추천", 요구내용: "디지털 정책 현황" }, 200);
  assert.deepEqual(aiNormal.body, {
    후보: [
      { 과: "디지털정책과", 근거: "AI 행정 도입 업무를 담당합니다." },
      { 과: "정보화담당관", 근거: "정보시스템 운영과 관련됩니다." },
      { 과: "데이터정책과", 근거: "데이터 정책과 관련됩니다." }
    ],
    해당없음: false
  });
  const aiNone = await checkWith(aiHandler, "AI추천 해당없음", { 작업: "AI추천", 요구내용: "판단 불가 요구" }, 200);
  assert.deepEqual(aiNone.body, { 후보: [], 해당없음: true });
  const aiOutside = await checkWith(aiHandler, "AI추천 목록 밖 과 제거", { 작업: "AI추천", 요구내용: "가짜 부서 요구" }, 200);
  assert.deepEqual(aiOutside.body, { 후보: [], 해당없음: true });

  const noKeyHandler = createHandler(store, { callOpenAI: (requirement) => require("./api/app.js").callOpenAI(requirement, "") });
  const noKey = await checkWith(noKeyHandler, "AI추천 키 누락", { 작업: "AI추천", 요구내용: "디지털 정책" }, 500);
  assert.match(noKey.body.error, /OPENAI_API_KEY/);

  console.log(`API 가짜 저장소 시험: ${checks.length}건 통과`);
  for (const result of checks) console.log(`- ${result}`);
  console.log(`- 최종 문항 ${get.body.cases.length}건, 처리 기록 ${get.body.log.length}건`);

  async function checkWith(targetHandler, name, body, expected) {
    const res = await call(targetHandler, "POST", body);
    assert.equal(res.statusCode, expected, `${name}: ${JSON.stringify(res.body)}`);
    checks.push(`${name} → ${res.statusCode}`);
    return res;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
