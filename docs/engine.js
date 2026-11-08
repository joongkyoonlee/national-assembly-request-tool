(function (root, factory) {
  const engine = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = engine;
  } else {
    root.DepartmentEngine = engine;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  let rules = [];
  let validDepartments = new Set();
  let initialized = false;

  function parseCsv(csvText) {
    const rows = [];
    let row = [];
    let value = "";
    let insideQuotes = false;
    const text = csvText.replace(/^\uFEFF/, "");

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];

      if (character === '"') {
        if (insideQuotes && text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (character === "," && !insideQuotes) {
        row.push(value);
        value = "";
      } else if ((character === "\n" || character === "\r") && !insideQuotes) {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(value);
        if (row.some((cell) => cell !== "")) rows.push(row);
        row = [];
        value = "";
      } else {
        value += character;
      }
    }

    if (value !== "" || row.length > 0) {
      row.push(value);
      rows.push(row);
    }

    if (rows.length === 0) return [];
    const headers = rows[0].map((header) => header.trim());

    return rows.slice(1).map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
    );
  }

  function normalize(text) {
    return String(text ?? "").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
  }

  function loadCsvTexts(ruleCsvText, organizationCsvText) {
    rules = parseCsv(ruleCsvText);
    validDepartments = new Set(
      parseCsv(organizationCsvText).map((row) => row.과.trim()).filter(Boolean)
    );
    initialized = true;
  }

  async function init(options = {}) {
    if (typeof window === "undefined") {
      if (!options.rulePath && !options.organizationPath) return;

      const fs = require("fs");
      const path = require("path");
      const dataDirectory = path.resolve(__dirname, "data");
      loadCsvTexts(
        fs.readFileSync(options.rulePath ?? path.join(dataDirectory, "rules_보강.csv"), "utf8"),
        fs.readFileSync(options.organizationPath ?? path.join(dataDirectory, "A부_조직도_26개과.csv"), "utf8")
      );
      return;
    }

    const ruleUrl = options.ruleUrl ?? "./data/rules_보강.csv";
    const organizationUrl = options.organizationUrl ?? "./data/A부_조직도_26개과.csv";
    const [ruleResponse, organizationResponse] = await Promise.all([
      fetch(ruleUrl),
      fetch(organizationUrl),
    ]);

    if (!ruleResponse.ok || !organizationResponse.ok) {
      throw new Error("분류용 CSV 파일을 불러오지 못했습니다.");
    }

    loadCsvTexts(await ruleResponse.text(), await organizationResponse.text());
  }

  function classify(requirement) {
    if (!initialized) {
      throw new Error("엔진이 준비되지 않았습니다. 브라우저에서는 먼저 await DepartmentEngine.init()을 호출하세요.");
    }

    const text = normalize(requirement);
    const candidates = new Map();

    for (const rule of rules) {
      const department = rule.과.trim();
      const keyword = rule.키워드.trim();
      const normalizedKeyword = normalize(keyword);
      const exclusions = String(rule.제외어 ?? "")
        .split("|")
        .map(normalize)
        .filter(Boolean);

      if (!validDepartments.has(department) || !normalizedKeyword) continue;
      if (!text.includes(normalizedKeyword)) continue;
      if (exclusions.some((exclusion) => text.includes(exclusion))) continue;

      const priority = Number(rule.우선순위) || 999;
      const previous = candidates.get(department);

      if (!previous || priority < previous.우선순위) {
        candidates.set(department, { 과: department, 우선순위: priority, 근거키워드: keyword });
      } else if (priority === previous.우선순위 && !previous.근거키워드.split(" | ").includes(keyword)) {
        previous.근거키워드 += ` | ${keyword}`;
      }
    }

    return [...candidates.values()]
      .sort((left, right) => left.우선순위 - right.우선순위 || left.과.localeCompare(right.과, "ko"))
      .slice(0, 3)
      .map((candidate) => ({ ...candidate, 점수: candidate.우선순위 }));
  }

  if (typeof module === "object" && module.exports) {
    const fs = require("fs");
    const path = require("path");
    const dataDirectory = path.resolve(__dirname, "data");
    loadCsvTexts(
      fs.readFileSync(path.join(dataDirectory, "rules_보강.csv"), "utf8"),
      fs.readFileSync(path.join(dataDirectory, "A부_조직도_26개과.csv"), "utf8")
    );
  }

  return { init, classify, parseCsv };
});
