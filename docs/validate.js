(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DataValidator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COMMON_HEADERS = ["연도", "예산(천원)", "집행액(천원)", "비고"];
  const REGISTER_REQUIRED = [
    "접수번호", "접수일", "국회구분", "위원회", "요구의원", "요구유형", "문항번호",
    "요구내용", "요구기간_시작", "요구기간_끝", "제출기한", "제출형식", "배분구분", "배분과", "처리상태"
  ];

  function text(value) { return String(value ?? "").trim(); }
  function number(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const parsed = Number(text(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  function issue(type, message, row, field) {
    const result = { 유형: type, 내용: message };
    if (row) result.행 = row;
    if (field) result.필드 = field;
    return result;
  }
  function validDate(value) {
    const source = text(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return false;
    const date = new Date(`${source}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === source;
  }

  function validateReply(matrix, requirement, options = {}) {
    const rows = Array.isArray(matrix) ? matrix.map((row) => Array.isArray(row) ? [...row] : []) : [];
    const issues = [];
    const firstLabel = text(rows[0]?.find((value) => text(value)));
    if (!firstLabel.startsWith("요구:")) issues.push(issue("형식", "1행에 '요구:'로 시작하는 요구 표시가 없음", 1));

    const headers = (rows[1] || []).map(text);
    if (!headers.some(Boolean)) issues.push(issue("형식", "2행 머리글이 없음", 2));
    for (const header of COMMON_HEADERS) {
      if (!headers.includes(header)) issues.push(issue("머리글", `필수 머리글 '${header}'이 없음`, 2, header));
    }

    const yearIndex = headers.indexOf("연도");
    const budgetIndex = headers.indexOf("예산(천원)");
    const spentIndex = headers.indexOf("집행액(천원)");
    const noteIndex = headers.indexOf("비고");
    const detail = [];
    let totalRow = null;
    rows.slice(2).forEach((row, offset) => {
      if (!row.some((value) => text(value))) return;
      if (text(row[0]).replace(/\s/g, "") === "합계") totalRow = { row, number: offset + 3 };
      else detail.push({ row, number: offset + 3 });
    });

    const recent = text(requirement).match(/최근\s*(\d+)\s*년/);
    if (recent && yearIndex >= 0) {
      const count = Number(recent[1]);
      const currentYear = Number(options.currentYear) || new Date().getFullYear();
      const present = new Set(detail.map((entry) => number(entry.row[yearIndex])).filter(Number.isInteger));
      const missing = [];
      for (let year = currentYear - count + 1; year <= currentYear; year += 1) if (!present.has(year)) missing.push(year);
      if (missing.length) issues.push(issue("연도 누락", `요구기간 연도 누락: ${missing.join(", ")}`, 0, "연도"));
    }

    if (budgetIndex >= 0 && spentIndex >= 0) {
      for (const entry of detail) {
        const budget = number(entry.row[budgetIndex]);
        const spent = number(entry.row[spentIndex]);
        const note = noteIndex >= 0 ? text(entry.row[noteIndex]) : "";
        if (budget !== null && spent !== null && spent > budget && !note) {
          issues.push(issue("예산 초과", `집행액 ${spent}이 예산 ${budget}을 초과했으나 비고에 사유가 없음`, entry.number, "비고"));
        }
      }
    }

    if (totalRow) {
      headers.forEach((header, column) => {
        if (!header || column === yearIndex || column === noteIndex) return;
        const stated = number(totalRow.row[column]);
        if (stated === null) return;
        const values = detail.map((entry) => number(entry.row[column])).filter((value) => value !== null);
        if (!values.length) return;
        const calculated = values.reduce((sum, value) => sum + value, 0);
        if (Math.abs(stated - calculated) > 0.000001) {
          issues.push(issue("합계 불일치", `${header} 합계 ${stated}이 세부 행 합 ${calculated}과 다름`, totalRow.number, header));
        }
      });
    }
    return { 확인필요: issues, 정상: issues.length === 0, 요구표시: firstLabel, 머리글: headers, 행: rows };
  }

  function validateRegister(rows, organization) {
    const records = Array.isArray(rows) ? rows : [];
    const allowed = new Set((organization || []).map((item) => text(typeof item === "string" ? item : item?.과)).filter(Boolean));
    const issues = [];
    const duplicateKeys = new Map();

    records.forEach((row, index) => {
      const rowNumber = index + 2;
      for (const field of REGISTER_REQUIRED) {
        if (!text(row?.[field])) issues.push(issue("공백", `${field} 값이 비어 있음`, rowNumber, field));
      }
      const departments = text(row?.배분과).split(/[|,;/]/).map((value) => value.trim()).filter(Boolean);
      for (const department of departments) {
        if (allowed.size && !allowed.has(department)) issues.push(issue("조직도 밖 과", `${department}은(는) 조직도에 없음`, rowNumber, "배분과"));
      }
      const start = number(row?.요구기간_시작);
      const end = number(row?.요구기간_끝);
      if (start !== null && end !== null && start > end) issues.push(issue("기간 역전", `요구기간 시작 ${start}이 끝 ${end}보다 늦음`, rowNumber, "요구기간"));

      const deadline = text(row?.제출기한);
      const received = text(row?.접수일);
      if (deadline && !validDate(deadline)) issues.push(issue("기한 형식", `제출기한 '${deadline}'의 형식이 YYYY-MM-DD가 아님`, rowNumber, "제출기한"));
      if (received && !validDate(received)) issues.push(issue("접수일 형식", `접수일 '${received}'의 형식이 YYYY-MM-DD가 아님`, rowNumber, "접수일"));
      if (validDate(deadline) && validDate(received) && deadline < received) issues.push(issue("기한 역전", `제출기한 ${deadline}이 접수일 ${received}보다 빠름`, rowNumber, "제출기한"));

      const duplicateKey = `${text(row?.요구의원).replace(/\s+/g, "")}::${text(row?.요구내용).replace(/\s+/g, " ")}`;
      if (duplicateKey !== "::") {
        if (!duplicateKeys.has(duplicateKey)) duplicateKeys.set(duplicateKey, []);
        duplicateKeys.get(duplicateKey).push(rowNumber);
      }
    });
    for (const duplicateRows of duplicateKeys.values()) {
      if (duplicateRows.length < 2) continue;
      for (const rowNumber of duplicateRows.slice(1)) issues.push(issue("중복 접수", `같은 의원의 같은 요구가 중복됨(최초 ${duplicateRows[0]}행)`, rowNumber, "요구내용"));
    }
    return { 확인필요: issues, 정상: issues.length === 0, 행수: records.length };
  }

  return { validateReply, validateRegister, validDate };
});
