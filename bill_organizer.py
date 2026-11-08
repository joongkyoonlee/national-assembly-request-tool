"""열린국회정보 ALLBILLV2 API에서 의안을 조회해 표와 CSV로 정리합니다."""

import argparse
import csv
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
API_URL = "https://open.assembly.go.kr/portal/openapi/ALLBILLV2"
API_RESPONSE_NAME = "ALLBILLV2"
PROGRAM_VERSION = "1.3"
OUTPUT_COLUMNS = {
    "ERACO": "국회대수",
    "BILL_NO": "의안번호",
    "BILL_NM": "의안명",
    "BILL_KND": "의안종류",
    "PPSR_KND": "제안자구분",
    "PPSR_NM": "제안자",
    "PPSL_DT": "제안일",
    "JRCMIT_NM": "소관위원회",
    "JRCMIT_CMMT_DT": "위원회회부일",
    "JRCMIT_PROC_DT": "위원회처리일",
    "JRCMIT_PROC_RSLT": "위원회처리결과",
    "RGS_RSLN_DT": "본회의의결일",
    "RGS_CONF_RSLT": "본회의처리결과",
    "PROM_LAW_NM": "공포법률명",
    "PROM_DT": "공포일",
    "PROM_NO": "공포번호",
    "LINK_URL": "상세링크",
}


def parse_arguments():
    """명령행에서 조회 조건과 저장 위치를 받습니다."""
    parser = argparse.ArgumentParser(description="국회 의안정보를 조회해 CSV로 정리합니다.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--bill-no", help="조회할 의안번호(예: 2108120)")
    group.add_argument("--all", action="store_true", help="ALLBILL 전체 의안을 페이지별로 조회")
    parser.add_argument("--era", default="제22대", help="국회 대수(기본값: 제22대, 예: 제21대 또는 21)")
    parser.add_argument("--page-size", type=int, default=100, choices=range(1, 101), metavar="1-100")
    parser.add_argument("--max-pages", type=int, default=0, help="전체 조회 시 최대 페이지 수(0이면 제한 없음)")
    parser.add_argument("--output", type=Path, help="저장할 CSV 경로")
    return parser.parse_args()


def get_api_key():
    """코드나 파일이 아닌 환경변수에서 인증키를 읽습니다."""
    api_key = os.getenv("ASSEMBLY_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("환경변수 ASSEMBLY_API_KEY가 없습니다. 사용법 문서를 따라 인증키를 설정하세요.")
    return api_key


def normalize_era(era, bill_no=None):
    """대수 표기를 API가 요구하는 '제22대' 형태로 통일합니다."""
    if bill_no and len(bill_no) >= 2 and bill_no[:2].isdigit():
        return f"제{int(bill_no[:2])}대"
    era = str(era).strip()
    if era.isdigit():
        return f"제{int(era)}대"
    if era.startswith("제") and era.endswith("대"):
        return era
    raise ValueError("대수는 22 또는 제22대와 같은 형식으로 입력하세요.")


def build_url(api_key, page_index, page_size, era, bill_no=None):
    """인증키와 조회 조건을 URL 인자로 안전하게 인코딩합니다."""
    params = {
        "KEY": api_key,
        "Type": "json",
        "pIndex": page_index,
        "pSize": page_size,
        "ERACO": era,
    }
    if bill_no:
        params["BILL_NO"] = bill_no
    return f"{API_URL}?{urlencode(params)}"


def extract_result(api_data):
    """열린국회정보의 JSON 응답에서 전체 건수, 결과코드와 의안 행을 꺼냅니다."""
    top_result = api_data.get("RESULT")
    if isinstance(top_result, dict):
        result_code = top_result.get("CODE", "알 수 없음")
        result_message = top_result.get("MESSAGE", "오류 설명 없음")
        raise RuntimeError(f"국회 API 오류 {result_code}: {result_message}")

    blocks = api_data.get(API_RESPONSE_NAME)
    if not isinstance(blocks, list):
        response_keys = ", ".join(api_data.keys()) or "없음"
        raise RuntimeError(
            f"응답에 {API_RESPONSE_NAME} 항목이 없습니다. 응답의 최상위 항목: {response_keys}"
        )

    total_count = 0
    result_code = ""
    result_message = ""
    rows = []

    for block in blocks:
        if "head" in block:
            for item in block["head"]:
                if "list_total_count" in item:
                    total_count = int(item["list_total_count"])
                if "RESULT" in item:
                    result_code = item["RESULT"].get("CODE", "")
                    result_message = item["RESULT"].get("MESSAGE", "")
        if "row" in block:
            rows.extend(block["row"])

    if result_code and result_code != "INFO-000":
        raise RuntimeError(f"국회 API 오류 {result_code}: {result_message}")
    return total_count, rows


def request_page(api_key, page_index, page_size, era, bill_no=None, opener=urlopen):
    """ALLBILLV2 API의 한 페이지를 호출하고 JSON 응답을 분석합니다."""
    url = build_url(api_key, page_index, page_size, era, bill_no)
    request = Request(url, headers={"User-Agent": "AssemblyBillOrganizer/1.0"})
    try:
        with opener(request, timeout=30) as response:
            api_data = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise RuntimeError(f"HTTP 오류 {error.code}: 국회 API 요청이 거부되었습니다.") from error
    except URLError as error:
        raise RuntimeError(f"네트워크 오류: {error.reason}") from error
    except json.JSONDecodeError as error:
        raise RuntimeError("API 응답이 JSON 형식이 아닙니다. 인증키와 Type 인자를 확인하세요.") from error
    return extract_result(api_data)


def collect_bills(api_key, bill_no, page_size, max_pages, era):
    """한 건 또는 전체 의안을 페이지 끝까지 모읍니다."""
    all_rows = []
    page_index = 1
    total_count = None

    while True:
        current_total, rows = request_page(api_key, page_index, page_size, era, bill_no)
        if total_count is None:
            total_count = current_total
        all_rows.extend(rows)

        if bill_no or not rows or len(all_rows) >= total_count:
            break
        if max_pages and page_index >= max_pages:
            break
        page_index += 1
        print(f"{len(all_rows):,}/{total_count:,}건 수집 중...", file=sys.stderr)

    return all_rows


def organize_row(row):
    """API 영문 필드를 업무에서 읽기 쉬운 한국어 열로 바꿉니다."""
    return {korean_name: row.get(api_name, "") or "" for api_name, korean_name in OUTPUT_COLUMNS.items()}


def save_csv(rows, output_path):
    """정리한 의안 목록을 엑셀에서 열 수 있는 UTF-8 CSV로 저장합니다."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=list(OUTPUT_COLUMNS.values()))
        writer.writeheader()
        writer.writerows(rows)


def shorten(text, width):
    """화면 표가 지나치게 길어지지 않도록 문자열을 줄입니다."""
    text = str(text)
    return text if len(text) <= width else text[: width - 1] + "…"


def print_table(rows):
    """조회 결과의 핵심 항목을 화면에 표로 보여줍니다."""
    print("| 의안번호 | 의안명 | 제안자 | 소관위원회 | 처리결과 |")
    print("|---|---|---|---|---|")
    for row in rows[:30]:
        print(
            f"| {row['의안번호']} | {shorten(row['의안명'], 32)} | "
            f"{shorten(row['제안자'], 20)} | {shorten(row['소관위원회'], 18)} | "
            f"{row['본회의처리결과']} |"
        )
    if len(rows) > 30:
        print(f"화면에는 처음 30건만 표시했습니다. 전체 {len(rows):,}건은 CSV에서 확인하세요.")


def default_output_path():
    """실행 시각을 넣어 기존 결과를 덮어쓰지 않는 파일명을 만듭니다."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return Path(__file__).parent / "output" / f"의안정리_{timestamp}.csv"


def main():
    """인증키 확인부터 조회, 표 출력, CSV 저장까지 실행합니다."""
    args = parse_arguments()
    print(f"국회 의안 정리 프로그램 v{PROGRAM_VERSION}", file=sys.stderr)
    try:
        api_key = get_api_key()
        era = normalize_era(args.era, args.bill_no)
        print(f"조회 대상: {era}", file=sys.stderr)
        raw_rows = collect_bills(api_key, args.bill_no, args.page_size, args.max_pages, era)
        organized_rows = [organize_row(row) for row in raw_rows]
        if not organized_rows:
            print("조회된 의안이 없습니다. 의안번호 또는 API 권한을 확인하세요.")
            return 1
        output_path = args.output or default_output_path()
        save_csv(organized_rows, output_path)
        print_table(organized_rows)
        print(f"\n총 {len(organized_rows):,}건을 저장했습니다: {output_path.resolve()}")
        return 0
    except (RuntimeError, ValueError) as error:
        print(f"오류: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"예상하지 못한 오류: {type(error).__name__}: {error}", file=sys.stderr)
        print("오류가 계속되면 이 두 줄을 복사해 전달해 주세요.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
