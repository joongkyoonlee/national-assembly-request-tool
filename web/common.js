(function (root) {
  "use strict";

  const STORAGE_KEY = "a부_국회요구자료_cases_v1";
  const LOG_KEY = "a부_국회요구자료_log_v1";

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function getCases() {
    return readJson(STORAGE_KEY, []);
  }

  function saveCases(cases) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
    window.dispatchEvent(new CustomEvent("cases-changed", { detail: cases }));
  }

  function addLog(action, caseId, detail = "") {
    const logs = readJson(LOG_KEY, []);
    logs.unshift({ 일시: new Date().toISOString(), 작업: action, 문항: caseId, 내용: detail });
    localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, 500)));
  }

  function registerCases(rows) {
    const existing = getCases();
    const known = new Set(existing.map((item) => item.id));
    const added = [];

    for (const row of rows) {
      const id = `${row.파일명}::${row.문항번호}`;
      if (known.has(id)) continue;
      const candidate = DepartmentEngine.classify(`${row.요구내용} ${row.세부항목}`.trim());
      const item = {
        id,
        ...row,
        상태: "접수",
        후보: candidate,
        주관과: candidate[0]?.과 ?? "",
        협조과: [],
        확정방법: "",
        등록일시: new Date().toISOString(),
        확정일시: ""
      };
      existing.push(item);
      added.push(item);
      known.add(id);
      addLog("접수", id, row.파일명);
    }

    saveCases(existing);
    return { added: added.length, skipped: rows.length - added.length, cases: existing };
  }

  function updateCase(caseId, changes, action = "수정") {
    const cases = getCases();
    const index = cases.findIndex((item) => item.id === caseId);
    if (index < 0) throw new Error("저장된 문항을 찾지 못했습니다.");
    cases[index] = { ...cases[index], ...changes };
    saveCases(cases);
    addLog(action, caseId, JSON.stringify(changes));
    return cases[index];
  }

  async function loadReferenceData() {
    const [organizationResponse] = await Promise.all([
      fetch("./data/A부_조직도_26개과.csv"),
      DepartmentEngine.init({
        ruleUrl: "./data/rules_보강.csv",
        organizationUrl: "./data/A부_조직도_26개과.csv"
      })
    ]);
    if (!organizationResponse.ok) throw new Error("조직도 CSV를 불러오지 못했습니다.");
    return DepartmentEngine.parseCsv(await organizationResponse.text());
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function showToast(message, type = "success") {
    let toast = document.querySelector("#app-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "app-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.className = `toast ${type} show`;
    toast.textContent = message;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  function statusCounts(cases = getCases()) {
    return cases.reduce((counts, item) => {
      counts[item.상태] = (counts[item.상태] || 0) + 1;
      return counts;
    }, {});
  }

  root.AppCommon = {
    STORAGE_KEY,
    getCases,
    saveCases,
    registerCases,
    updateCase,
    loadReferenceData,
    escapeHtml,
    showToast,
    statusCounts
  };

  document.addEventListener("click", (event) => {
    const disabledLink = event.target.closest('a[aria-disabled="true"]');
    if (!disabledLink) return;
    event.preventDefault();
    showToast("이 화면은 다음 단계에서 구현합니다.", "error");
  });
})(globalThis);
