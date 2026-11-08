(function (root) {
  "use strict";
  const STORAGE_KEY = "a부_국회요구자료_db_v2";
  const OLD_CASES_KEY = "a부_국회요구자료_cases_v1";
  const OLD_LOG_KEY = "a부_국회요구자료_log_v1";
  const API_URL = "/api/app";
  const serverMode = location.hostname.endsWith(".vercel.app");
  let referencePromise;

  function emptyDb() { return { cases: [], log: [] }; }
  function readLocalDb() {
    try {
      const current = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (current && Array.isArray(current.cases) && Array.isArray(current.log)) return current;
    } catch (_) {}
    try {
      const cases = JSON.parse(localStorage.getItem(OLD_CASES_KEY));
      const log = JSON.parse(localStorage.getItem(OLD_LOG_KEY));
      if (Array.isArray(cases)) return { cases, log: Array.isArray(log) ? log : [] };
    } catch (_) {}
    return emptyDb();
  }
  function writeLocalDb(db) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    window.dispatchEvent(new CustomEvent("cases-changed", { detail: db }));
  }
  async function requestJson(url, options) {
    const response = await fetch(url, options);
    let body;
    try { body = await response.json(); } catch (_) { body = {}; }
    if (!response.ok) throw new Error(body.error || `요청에 실패했습니다(${response.status}).`);
    return body;
  }
  async function getDb() {
    return serverMode ? requestJson(API_URL, { cache: "no-store" }) : readLocalDb();
  }
  async function getCases() { return (await getDb()).cases || []; }
  async function applyRequest(request) {
    if (serverMode || request?.작업 === "AI추천") {
      const result = await requestJson(API_URL, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request)
      });
      window.dispatchEvent(new CustomEvent("cases-changed", { detail: result }));
      return result;
    }
    const db = readLocalDb();
    const { organization } = await loadReferenceData();
    const result = Flow.apply(db, request, organization);
    writeLocalDb(db);
    return result;
  }
  async function registerCases(rows) {
    const known = new Set((await getCases()).map((item) => item.id));
    let added = 0;
    let skipped = 0;
    for (const row of rows) {
      const id = `${row.파일명}::${row.문항번호}`;
      if (known.has(id)) { skipped += 1; continue; }
      const 후보 = DepartmentEngine.classify(`${row.요구내용} ${row.세부항목}`.trim());
      await applyRequest({ 작업: "접수", id, ...row, 후보 });
      known.add(id);
      added += 1;
    }
    return { added, skipped, cases: await getCases() };
  }
  async function loadReferenceData() {
    if (!referencePromise) {
      referencePromise = Promise.all([
        fetch("./data/A부_조직도_26개과.csv"), fetch("./data/접수대장.csv"),
        DepartmentEngine.init({ ruleUrl: "./data/rules_보강.csv", organizationUrl: "./data/A부_조직도_26개과.csv" })
      ]).then(async ([organizationResponse, historyResponse]) => {
        if (!organizationResponse.ok) throw new Error("조직도 CSV를 불러오지 못했습니다.");
        if (!historyResponse.ok) throw new Error("과거 접수대장 CSV를 불러오지 못했습니다.");
        return {
          organization: DepartmentEngine.parseCsv(await organizationResponse.text()),
          history: DepartmentEngine.parseCsv(await historyResponse.text())
        };
      }).catch((error) => { referencePromise = undefined; throw error; });
    }
    return referencePromise;
  }
  function historyFor(item, rows) {
    const first = Array.isArray(item.후보) ? item.후보[0] : null;
    const keywords = String(first && first.근거키워드 || "").split("|").map((word) => word.trim()).filter(Boolean);
    if (!keywords.length) return { keyword: "", count: 0, mainDepartment: "", recent: [] };
    const matched = rows.filter((row) => keywords.some((word) => String(row.요구내용 || "").includes(word)));
    const counts = new Map();
    for (const row of matched) counts.set(row.배분과, (counts.get(row.배분과) || 0) + 1);
    const mainDepartment = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))[0]?.[0] || "";
    const recent = [...matched].sort((a, b) => String(b.접수일).localeCompare(String(a.접수일))).slice(0, 5);
    return { keyword: keywords.join(" · "), count: matched.length, mainDepartment, recent };
  }
  function historyMarkup(item, rows) {
    const result = historyFor(item, rows);
    if (!result.keyword) return '<div class="history-box empty-history">1순위 근거 키워드가 없어 과거 이력을 찾지 않았습니다.</div>';
    const summary = result.count ? `${result.count}건 · 주로 ${escapeHtml(result.mainDepartment)}` : "0건";
    const recent = result.recent.length
      ? `<ol>${result.recent.map((row) => `<li><b>${escapeHtml(row.접수일)}</b> ${escapeHtml(row.요구내용)} <span>${escapeHtml(row.배분과)}</span></li>`).join("")}</ol>`
      : '<p class="minor">일치하는 과거 요구가 없습니다.</p>';
    return `<details class="history-box"><summary>과거 이력 <b>${summary}</b> <small>근거: ${escapeHtml(result.keyword)}</small></summary>${recent}</details>`;
  }
  function setStorageIndicators() {
    const label = serverMode ? "서버 공동 저장" : "현재 브라우저 저장";
    document.querySelectorAll("[data-storage-mode]").forEach((element) => {
      element.textContent = `저장 위치: ${label}`;
      element.classList.toggle("server", serverMode);
    });
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }
  function showToast(message, type = "success") {
    let toast = document.querySelector("#app-toast");
    if (!toast) {
      toast = document.createElement("div"); toast.id = "app-toast"; toast.setAttribute("role", "status"); document.body.appendChild(toast);
    }
    toast.className = `toast ${type} show`; toast.textContent = message;
    clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }
  function statusCounts(cases) {
    return (cases || []).reduce((counts, item) => {
      counts[item.상태] = (counts[item.상태] || 0) + 1; return counts;
    }, {});
  }
  root.AppCommon = {
    STORAGE_KEY, serverMode, getDb, getCases, applyRequest, registerCases, loadReferenceData,
    historyFor, historyMarkup, escapeHtml, showToast, statusCounts, setStorageIndicators
  };
  document.addEventListener("DOMContentLoaded", setStorageIndicators);
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[aria-disabled="true"]');
    if (!link) return; event.preventDefault(); showToast("이 화면은 다음 단계에서 구현합니다.", "error");
  });
})(globalThis);
