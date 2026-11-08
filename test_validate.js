const assert = require("node:assert/strict");
const { validateReply, validateRegister } = require("./web/validate.js");
const organization = require("./api/org.json");

function types(result) { return new Set(result.확인필요.map((entry) => entry.유형)); }

const validReply = [
  ["요구: 의원C 문항1 최근 3년 예산 현황"],
  ["연도", "사업명", "예산(천원)", "집행액(천원)", "비고"],
  [2024, "사업A", 100, 90, ""],
  [2025, "사업A", 120, 110, ""],
  [2026, "사업A", 130, 140, "집행 증가 사유 기재"],
  ["합계", "", 350, 340, ""]
];
const validResult = validateReply(validReply, "최근 3년 예산 현황", { currentYear: 2026 });
assert.equal(validResult.정상, true);

const invalidReply = [
  ["표시 형식 오류"],
  ["연도", "사업명", "예산(천원)", "집행액(천원)", "비고"],
  [2024, "사업A", 100, 130, ""],
  [2026, "사업A", 200, 150, ""],
  ["합계", "", 999, 280, ""]
];
const invalidResult = validateReply(invalidReply, "최근 3년 예산 현황", { currentYear: 2026 });
assert.deepEqual([...types(invalidResult)].sort(), ["연도 누락", "예산 초과", "합계 불일치", "형식"].sort());
assert.equal(invalidReply[2][2], 100, "원본 값은 바뀌지 않아야 함");

const base = {
  접수번호: "2026-0001", 접수일: "2026-09-01", 국회구분: "상임위", 위원회: "행정안전위원회",
  요구의원: "의원A", 요구유형: "자료요구", 문항번호: "1", 요구내용: "동일 요구",
  요구기간_시작: "2024", 요구기간_끝: "2026", 제출기한: "2026-09-03", 제출형식: "엑셀",
  배분구분: "소관", 배분과: "디지털정책과", 처리상태: "배분완료"
};
const registerRows = [base, {
  ...base, 접수번호: "2026-0002", 접수일: "2026-09-05", 요구기간_시작: "2027", 요구기간_끝: "2026",
  제출기한: "2026/09/04", 배분과: "없는과"
}, { ...base, 접수번호: "", 요구의원: "의원B", 요구내용: "다른 요구", 제출기한: "2026-08-31" }];
const registerResult = validateRegister(registerRows, organization);
const registerTypes = types(registerResult);
for (const expected of ["조직도 밖 과", "기간 역전", "기한 형식", "중복 접수", "공백", "기한 역전"]) {
  assert.equal(registerTypes.has(expected), true, `${expected} 검출 실패`);
}
assert.equal(registerRows[1].배분과, "없는과", "접수대장 원본 값은 바뀌지 않아야 함");

console.log("검증 규칙 시험: 3개 묶음 통과");
console.log(`- 정상 회신: 확인필요 ${validResult.확인필요.length}건`);
console.log(`- 이상 회신: 확인필요 ${invalidResult.확인필요.length}건`);
console.log(`- 접수대장: 확인필요 ${registerResult.확인필요.length}건`);
