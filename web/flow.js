(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.Flow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CASE_FIELDS = [
    "id", "파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용",
    "세부항목", "비고"
  ];
  const METHODS = new Set(["규칙", "AI", "수정"]);

  class FlowError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "FlowError";
      this.status = status;
    }
  }

  function fail(status, message) {
    throw new FlowError(status, message);
  }

  function text(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function removePersonalFields(value) {
    if (Array.isArray(value)) return value.map(removePersonalFields);
    if (!value || typeof value !== "object") return value;
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(이름|성명|연락처|전화번호|휴대폰|주민등록번호|이메일)$/.test(key.trim())) continue;
      clean[key] = removePersonalFields(item);
    }
    return clean;
  }

  function now(request) {
    return text(request.일시) || new Date().toISOString();
  }

  function departments(org) {
    if (!Array.isArray(org)) fail(500, "조직도 형식이 올바르지 않음");
    return new Set(org.map((item) => text(typeof item === "string" ? item : item && item.과)).filter(Boolean));
  }

  function ensureDb(db) {
    if (!db || typeof db !== "object" || Array.isArray(db)) fail(500, "cases.json 형식이 올바르지 않음");
    if (!Array.isArray(db.cases)) db.cases = [];
    if (!Array.isArray(db.log)) db.log = [];
    return db;
  }

  function findCase(db, id) {
    if (!id) fail(400, "id는 필수임");
    const item = db.cases.find((entry) => entry && entry.id === id);
    if (!item) fail(400, `${id} 문항을 찾을 수 없음`);
    return item;
  }

  function requireState(item, allowed, action) {
    if (!allowed.includes(item.상태)) {
      fail(409, `${item.상태} 상태에서는 ${action} 작업을 할 수 없음`);
    }
  }

  function requireDepartment(name, orgSet, field) {
    if (!name) fail(400, `${field}은(는) 필수임`);
    if (!orgSet.has(name)) fail(400, `${name}은(는) 조직도에 없는 과임`);
  }

  function assignedDepartments(item) {
    return [item.주관과].concat(Array.isArray(item.협조과) ? item.협조과 : []).filter(Boolean);
  }

  function saveCandidates(value) {
    if (!Array.isArray(value)) return [];
    return value.map((candidate) => {
      if (typeof candidate === "string") return candidate;
      if (!candidate || typeof candidate !== "object") return "";
      const saved = { 과: text(candidate.과) };
      if (text(candidate.근거)) saved.근거 = text(candidate.근거);
      if (text(candidate.근거키워드)) saved.근거키워드 = text(candidate.근거키워드);
      if (Number.isFinite(Number(candidate.우선순위))) saved.우선순위 = Number(candidate.우선순위);
      if (Number.isFinite(Number(candidate.점수))) saved.점수 = Number(candidate.점수);
      return saved;
    }).filter(Boolean);
  }

  function addLog(db, at, action, id, department, reason) {
    const record = { 일시: at, 작업: action, 문항: id };
    if (department) record.과 = department;
    if (reason) record.사유 = reason;
    db.log.push(record);
  }

  function receive(db, request, at) {
    const id = text(request.id);
    if (!id) fail(400, "id는 필수임");
    if (db.cases.some((item) => item && item.id === id)) fail(409, `${id} 문항은 이미 접수됨`);
    if (!text(request.요구내용)) fail(400, "요구내용은 필수임");

    const item = {};
    for (const field of CASE_FIELDS) {
      if (request[field] !== undefined) item[field] = request[field];
    }
    item.id = id;
    item.요구내용 = text(request.요구내용);
    item.상태 = "접수";
    item.주관과 = "";
    item.협조과 = [];
    item.확정방법 = "";
    item.후보 = saveCandidates(request.후보);
    item["과별 회신"] = {};
    item.재배정 = [];
    item.보완 = [];
    item["확정 코멘트"] = "";
    item.일시 = { 접수: at, 수정: at };
    db.cases.push(item);
    addLog(db, at, "접수", id);
    return item;
  }

  function assign(db, request, orgSet, at) {
    const item = findCase(db, text(request.id));
    requireState(item, ["접수", "재배정요청", "배분확정"], "배분");

    const lead = text(request.주관과);
    const helpers = Array.isArray(request.협조과)
      ? [...new Set(request.협조과.map(text).filter(Boolean))]
      : [];
    const method = text(request.확정방법);
    requireDepartment(lead, orgSet, "주관과");
    for (const helper of helpers) requireDepartment(helper, orgSet, "협조과");
    if (helpers.includes(lead)) fail(400, "주관과를 협조과에 중복 지정할 수 없음");
    if (!METHODS.has(method)) fail(400, "확정방법은 규칙, AI, 수정 중 하나여야 함");

    const candidates = Array.isArray(request.후보)
      ? [...new Set(request.후보.map((candidate) => text(
          candidate && typeof candidate === "object" ? candidate.과 : candidate
        )).filter(Boolean))]
      : [];
    for (const candidate of candidates) requireDepartment(candidate, orgSet, "후보 과");

    item.주관과 = lead;
    item.협조과 = helpers;
    item.확정방법 = method;
    item.후보 = saveCandidates(request.후보);
    item.상태 = "배분확정";
    item.일시 = item.일시 && typeof item.일시 === "object" ? item.일시 : {};
    item.일시.배분 = at;
    item.일시.수정 = at;
    addLog(db, at, "배분", item.id, lead);
    return item;
  }

  function reply(db, request, orgSet, at) {
    const item = findCase(db, text(request.id));
    requireState(item, ["배분확정", "회신중", "보완요청"], "회신");
    const department = text(request.과);
    requireDepartment(department, orgSet, "과");
    if (!assignedDepartments(item).includes(department)) {
      fail(403, `${department}는 이 문항의 담당 과가 아님`);
    }
    if (item.상태 === "보완요청") {
      const pending = Array.isArray(item.보완) ? [...item.보완].reverse().find((entry) => !entry.완료) : null;
      if (!pending || pending.과 !== department) fail(403, `${department}는 이 보완요청의 대상 과가 아님`);
      pending.완료 = true;
      pending.완료일시 = at;
    }

    const replies = item["과별 회신"] && typeof item["과별 회신"] === "object"
      ? item["과별 회신"]
      : {};
    const saved = { 일시: at };
    if (text(request.파일명)) saved.파일명 = text(request.파일명);
    if (Array.isArray(request.행)) saved.행 = removePersonalFields(request.행);
    if (request.메모 !== undefined) saved.메모 = request.메모;
    if (Array.isArray(request.확인필요)) saved.확인필요 = request.확인필요;
    replies[department] = saved;
    item["과별 회신"] = replies;

    const allReplied = assignedDepartments(item).every((name) => Boolean(replies[name]));
    item.상태 = allReplied ? "회신완료" : "회신중";
    item.일시 = item.일시 && typeof item.일시 === "object" ? item.일시 : {};
    item.일시.수정 = at;
    addLog(db, at, "회신", item.id, department);
    return item;
  }

  function requestSupplement(db, request, orgSet, at) {
    const item = findCase(db, text(request.id));
    requireState(item, ["회신중", "회신완료"], "보완요청");
    const department = text(request.과);
    const reason = text(request.사유);
    requireDepartment(department, orgSet, "과");
    if (!assignedDepartments(item).includes(department)) fail(403, `${department}는 이 문항의 담당 과가 아님`);
    if (!reason) fail(400, "보완요청 사유는 필수임");
    if (!item["과별 회신"]?.[department]) fail(409, `${department}의 회신이 없어 보완을 요청할 수 없음`);
    if (!Array.isArray(item.보완)) item.보완 = [];
    item.보완.push({ 일시: at, 과: department, 사유: reason, 완료: false });
    item.상태 = "보완요청";
    item.일시 = item.일시 && typeof item.일시 === "object" ? item.일시 : {};
    item.일시.수정 = at;
    addLog(db, at, "보완요청", item.id, department, reason);
    return item;
  }

  function confirmCase(db, request, at) {
    const item = findCase(db, text(request.id));
    requireState(item, ["회신완료"], "확정");
    const comment = text(request.코멘트);
    if (!comment) fail(400, "확정 코멘트는 필수임");
    item["확정 코멘트"] = comment;
    item.상태 = "확정";
    item.일시 = item.일시 && typeof item.일시 === "object" ? item.일시 : {};
    item.일시.확정 = at;
    item.일시.수정 = at;
    addLog(db, at, "확정", item.id, "", comment);
    return item;
  }

  function requestReassignment(db, request, orgSet, at) {
    const item = findCase(db, text(request.id));
    requireState(item, ["배분확정", "회신중", "보완요청"], "재배정요청");
    const department = text(request.과);
    const reason = text(request.사유);
    requireDepartment(department, orgSet, "과");
    if (!assignedDepartments(item).includes(department)) {
      fail(403, `${department}는 이 문항의 담당 과가 아님`);
    }
    if (!reason) fail(400, "재배정요청 사유는 필수임");
    const wanted = text(request.희망과);
    if (wanted) requireDepartment(wanted, orgSet, "희망과");

    if (!Array.isArray(item.재배정)) item.재배정 = [];
    const record = { 일시: at, 과: department, 사유: reason };
    if (wanted) record.희망과 = wanted;
    item.재배정.push(record);
    item.상태 = "재배정요청";
    item.일시 = item.일시 && typeof item.일시 === "object" ? item.일시 : {};
    item.일시.수정 = at;
    addLog(db, at, "재배정요청", item.id, department, reason);
    return item;
  }

  function apply(db, request, org) {
    ensureDb(db);
    if (!request || typeof request !== "object" || Array.isArray(request)) fail(400, "요청 형식이 올바르지 않음");
    const action = text(request.작업);
    if (!action) fail(400, "작업은 필수임");
    const at = now(request);
    const orgSet = departments(org);
    let item;

    if (action === "접수") item = receive(db, request, at);
    else if (action === "배분") item = assign(db, request, orgSet, at);
    else if (action === "회신") item = reply(db, request, orgSet, at);
    else if (action === "재배정요청") item = requestReassignment(db, request, orgSet, at);
    else if (action === "보완요청") item = requestSupplement(db, request, orgSet, at);
    else if (action === "확정") item = confirmCase(db, request, at);
    else fail(400, `${action} 작업은 아직 지원하지 않음`);

    return { ok: true, 상태: item.상태, case: item };
  }

  return { apply, FlowError };
});
