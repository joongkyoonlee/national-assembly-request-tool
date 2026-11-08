from __future__ import annotations

import contextlib
import json
import socket
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent
STORAGE_KEY = "a부_국회요구자료_db_v2"
DB = {
    "cases": [
        {"id": "의원A-01", "상태": "배분확정", "파일명": "A.pdf"},
        {"id": "의원A-02", "상태": "회신중", "파일명": "A.pdf"},
        {"id": "의원B-01", "상태": "확정", "파일명": "B.pdf"},
        {"id": "기한-D1", "상태": "배분확정", "파일명": "기한.pdf", "제출기한": "2026-11-10", "주관과": "산업정책과", "협조과": [], "요구내용": "산업정책 추진 실적", "과별 회신": {}},
        {"id": "기한-경과", "상태": "회신중", "파일명": "기한.pdf", "제출기한": "2026-11-08", "주관과": "안전정책과", "협조과": [], "요구내용": "안전관리 현황", "과별 회신": {}},
        {"id": "기한-미래", "상태": "배분확정", "파일명": "기한.pdf", "제출기한": "2026-11-15", "주관과": "지역정책과", "협조과": [], "요구내용": "지역정책 현황", "과별 회신": {}},
        {"id": "기한-회신", "상태": "회신중", "파일명": "기한.pdf", "제출기한": "2026-11-09", "주관과": "인재정책과", "협조과": [], "요구내용": "인재정책 현황", "과별 회신": {"인재정책과": {"일시": "2026-11-08T00:00:00Z"}}},
        {"id": "기한-확인", "상태": "배분확정", "파일명": "기한.pdf", "제출기한": "날짜 미정", "주관과": "디지털정책과", "협조과": [], "요구내용": "디지털 정책 현황", "과별 회신": {}},
    ],
    "log": [
        {"일시": "2026-11-08T00:00:00.000Z", "작업": "배분", "문항": "의원A-01", "과": "산업정책과"},
        {"일시": "2026-11-08T01:00:00.000Z", "작업": "회신", "문항": "의원A-02", "과": "산업정책과"},
        {"일시": "2026-11-08T02:00:00.000Z", "작업": "확정", "문항": "의원B-01", "과": "안전정책과"},
    ],
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@contextlib.contextmanager
def web_server():
    port = free_port()
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}/web/index.html"
    finally:
        server.shutdown()
        thread.join(timeout=2)


def main() -> None:
    with web_server() as url, sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(accept_downloads=True)
        page.add_init_script(
            f"localStorage.setItem({json.dumps(STORAGE_KEY)}, "
            f"JSON.stringify({json.dumps(DB, ensure_ascii=False)}));"
        )
        page.goto(url)
        page.wait_for_selector("#log-body tr")
        assert page.get_by_role("button", name="처리 기록 엑셀 다운로드").is_visible(), (
            "처리 기록 엑셀 다운로드 버튼이 보이지 않음"
        )

        page.select_option("#log-department", "산업정책과")
        industrial_count = page.locator("#log-body tr").count()
        assert industrial_count == 2, f"산업정책과 필터 결과가 2건이 아님: {industrial_count}"
        displayed_time = page.locator("#log-body tr:first-child td:first-child").inner_text()
        assert "09:00:00" in displayed_time, f"UTC→한국시간 변환이 맞지 않음: {displayed_time}"

        with page.expect_download() as download_info:
            page.click("#log-export")
        download_path = Path(download_info.value.path())
        workbook = load_workbook(BytesIO(download_path.read_bytes()), read_only=True, data_only=True)
        excel_count = workbook["처리기록"].max_row - 1
        assert excel_count == industrial_count, (
            f"화면 {industrial_count}건과 엑셀 {excel_count}행이 다름"
        )

        page.select_option("#log-department", "")
        page.fill("#log-case-prefix", "의원A-0")
        question_cells = page.locator("#log-body tr td:nth-child(3)").all_text_contents()
        assert question_cells and all(value.startswith("의원A-0") for value in question_cells), (
            f"문항 앞부분 필터가 맞지 않음: {question_cells}"
        )
        assert len(question_cells) == 2, f"문항 필터 결과가 2건이 아님: {len(question_cells)}"

        page.goto(url.replace("index.html", "collect.html"))
        page.get_by_role("tab", name="기한 임박").click()
        page.fill("#deadline-base-date", "2026-11-09")
        page.fill("#deadline-days", "2")
        page.fill("#deadline-sender", "국회 총괄 담당")
        page.wait_for_function("document.querySelectorAll('#deadline-body tr').length === 2")

        deadline_rows = page.locator("#deadline-body tr").all_text_contents()
        assert any("D-1" in row and "기한-D1" in row for row in deadline_rows), f"D-1 대상 누락: {deadline_rows}"
        assert any("기한 경과" in row and "기한-경과" in row for row in deadline_rows), f"기한 경과 대상 누락: {deadline_rows}"
        assert page.locator("#deadline-issue-body tr").count() == 1, "날짜 확인필요가 1건이 아님"

        with page.expect_download() as deadline_download_info:
            page.click("#deadline-xlsx")
        deadline_download = Path(deadline_download_info.value.path())
        deadline_book = load_workbook(BytesIO(deadline_download.read_bytes()), read_only=True, data_only=True)
        assert deadline_book.sheetnames == ["독촉목록", "확인필요"], f"엑셀 시트가 다름: {deadline_book.sheetnames}"
        assert deadline_book["독촉목록"].max_row - 1 == 2, "독촉목록 엑셀 행 수가 2가 아님"
        assert deadline_book["확인필요"].max_row - 1 == 1, "확인필요 엑셀 행 수가 1이 아님"

        with page.expect_download() as notice_download_info:
            page.click("#deadline-notices")
        notice_path = Path(notice_download_info.value.path())
        notice_text = notice_path.read_text(encoding="utf-8-sig")
        for expected in ["수신: 산업정책과", "수신: 안전정책과", "제목:", "건수: 1건", "목록:", "발신: 국회 총괄 담당"]:
            assert expected in notice_text, f"안내문 필수 항목 누락: {expected}"

        page.fill("#deadline-base-date", "2026-11-07")
        page.fill("#deadline-days", "0")
        page.wait_for_function("document.querySelector('#deadline-summary').textContent.includes('대상 0건')")
        assert page.locator("#deadline-body tr").count() == 0, "대상 0건 조건에서 행이 남음"

        browser.close()
        print("웹 화면 시험: 7개 통과")
        print(f"- 산업정책과: 화면 {industrial_count}건 · 엑셀 {excel_count}행")
        print(f"- 문항 앞부분 일치: {len(question_cells)}건")
        print("- 기한 임박: D-1 1건 · 기한 경과 1건 · 대상 0건 확인")
        print("- 독촉 엑셀: 독촉목록 2행 · 확인필요 1행")
        print("- 과별 안내문: 수신·제목·건수·목록·발신 확인")


if __name__ == "__main__":
    main()
