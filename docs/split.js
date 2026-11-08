(function (root) {
  "use strict";

  const FIELDS = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"];

  function appendText(current, field, text) {
    const separator = field === "세부항목" && current[field] ? " / " : " ";
    current[field] = `${current[field]}${separator}${text}`.trim();
  }

  function parseLines(lines, filename) {
    const cleanLines = lines.map((line) => line.trim()).filter(Boolean);
    if (!cleanLines.length) throw new Error(`${filename}: 텍스트를 추출하지 못했습니다.`);

    const header = cleanLines[0].match(/^(.+?위원회)\s+(.+?)\s+의원실\s+자료요구서$/);
    if (!header) throw new Error(`${filename}: 첫 줄에서 위원회·의원을 찾지 못했습니다.`);
    const [, committee, member] = header;

    let deadline = "";
    for (const line of cleanLines) {
      if (!line.startsWith("수신:")) continue;
      const date = line.match(/제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
      if (date) deadline = `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`;
      break;
    }
    if (!deadline) throw new Error(`${filename}: 제출기한을 찾지 못했습니다.`);

    const questions = [];
    let current = null;
    let activeField = "요구내용";

    for (const line of cleanLines.slice(1)) {
      if (line.startsWith("수신:") || line.startsWith("담당 보좌관:") || line === "끝.") continue;
      const question = line.match(/^(\d+)\.\s*(.*)$/);
      const detail = line.match(/^([가-힣])\.\s*(.*)$/);
      const note = line.match(/^※\s*(.*)$/);

      if (question) {
        if (current) questions.push(current);
        current = {
          파일명: filename,
          위원회: committee,
          의원: member,
          제출기한: deadline,
          문항번호: question[1],
          요구내용: question[2].trim(),
          세부항목: "",
          비고: ""
        };
        activeField = "요구내용";
      } else if (detail && current) {
        appendText(current, "세부항목", `${detail[1]}. ${detail[2].trim()}`);
        activeField = "세부항목";
      } else if (note && current) {
        appendText(current, "비고", note[1].trim());
        activeField = "비고";
      } else if (current) {
        appendText(current, activeField, line);
      }
    }
    if (current) questions.push(current);
    return questions;
  }

  function expectedCount(filename) {
    const match = filename.match(/_(\d+)문항\.pdf$/i);
    return match ? Number(match[1]) : null;
  }

  function validate(filename, rows) {
    const expected = expectedCount(filename);
    const numbers = rows.map((row) => Number(row.문항번호));
    const continuous = numbers.every((number, index) => number === index + 1);
    const last = numbers.at(-1) || 0;
    return {
      파일명: filename,
      기대문항수: expected,
      추출문항수: rows.length,
      마지막번호: last,
      번호연속: continuous,
      일치: expected === null ? continuous : expected === rows.length && expected === last && continuous
    };
  }

  function parseCsv(text) {
    const rows = DepartmentEngine.parseCsv(text);
    return rows.map((row) => Object.fromEntries(FIELDS.map((field) => [field, String(row[field] ?? "").trim()])));
  }

  root.RequirementSplitter = { FIELDS, parseLines, expectedCount, validate, parseCsv };
})(globalThis);
