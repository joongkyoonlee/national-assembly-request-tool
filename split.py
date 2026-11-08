"""원문 자료요구서 PDF 3건을 문항 단위 CSV로 분리한다."""

import csv
import re
import sys
from pathlib import Path

from pypdf import PdfReader


BASE_DIR = Path(__file__).resolve().parent
SOURCE_DIR = BASE_DIR / "원문"
OUTPUT_PATH = BASE_DIR / "data" / "문항목록.csv"
FIELDNAMES = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"]


def extract_lines(pdf_path):
    """PDF의 모든 페이지에서 빈 줄을 제외한 텍스트 줄을 순서대로 꺼낸다."""
    reader = PdfReader(pdf_path)
    lines = []
    for page in reader.pages:
        text = page.extract_text() or ""
        lines.extend(line.strip() for line in text.splitlines() if line.strip())
    return lines


def append_text(current, field, text):
    """같은 항목의 여러 줄을 읽기 쉽도록 한 칸 띄워 이어 붙인다."""
    separator = " / " if field == "세부항목" and current[field] else " "
    current[field] = f"{current[field]}{separator}{text}".strip()


def parse_pdf(pdf_path):
    """처리지침 제2장과 사용자 지정 규칙에 따라 PDF 한 건을 문항으로 나눈다."""
    lines = extract_lines(pdf_path)
    if not lines:
        raise ValueError(f"텍스트를 추출하지 못했습니다: {pdf_path.name}")

    header_match = re.match(r"^(.+?위원회)\s+(.+?)\s+의원실\s+자료요구서$", lines[0])
    if not header_match:
        raise ValueError(f"첫 줄에서 위원회·의원을 찾지 못했습니다: {pdf_path.name}")
    committee, member = header_match.groups()

    deadline = ""
    for line in lines:
        if line.startswith("수신:"):
            date_match = re.search(r"제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.", line)
            if date_match:
                year, month, day = map(int, date_match.groups())
                deadline = f"{year:04d}-{month:02d}-{day:02d}"
            break
    if not deadline:
        raise ValueError(f"제출기한을 찾지 못했습니다: {pdf_path.name}")

    questions = []
    current = None
    active_field = "요구내용"

    for line in lines[1:]:
        if line.startswith(("수신:", "담당 보좌관:")) or line == "끝.":
            continue

        question_match = re.match(r"^(\d+)\.\s*(.*)$", line)
        detail_match = re.match(r"^([가-힣])\.\s*(.*)$", line)
        note_match = re.match(r"^※\s*(.*)$", line)

        if question_match:
            if current:
                questions.append(current)
            number, content = question_match.groups()
            current = {
                "파일명": pdf_path.name,
                "위원회": committee,
                "의원": member,
                "제출기한": deadline,
                "문항번호": number,
                "요구내용": content.strip(),
                "세부항목": "",
                "비고": "",
            }
            active_field = "요구내용"
        elif detail_match and current:
            marker, content = detail_match.groups()
            append_text(current, "세부항목", f"{marker}. {content.strip()}")
            active_field = "세부항목"
        elif note_match and current:
            append_text(current, "비고", note_match.group(1).strip())
            active_field = "비고"
        elif current:
            append_text(current, active_field, line)

    if current:
        questions.append(current)
    return questions


def expected_count_from_filename(filename):
    """파일명의 '25문항'과 같은 표기에서 기대 문항 수를 읽는다."""
    match = re.search(r"_(\d+)문항\.pdf$", filename)
    return int(match.group(1)) if match else None


def validate_file(pdf_path, rows):
    """파일명 문항 수, 마지막 번호와 번호 연속 여부를 검증한다."""
    expected = expected_count_from_filename(pdf_path.name)
    numbers = [int(row["문항번호"]) for row in rows]
    last_number = numbers[-1] if numbers else 0
    continuous = numbers == list(range(1, last_number + 1))
    matched = expected == len(rows) == last_number and continuous
    return {
        "파일명": pdf_path.name,
        "파일명의 문항 수": expected,
        "뽑은 문항 수": len(rows),
        "마지막 번호": last_number,
        "번호 연속": "O" if continuous else "X",
        "일치": "O" if matched else "X",
    }


def print_validation_table(results):
    """요청된 파일별 확인표를 화면에 출력한다."""
    print("| 파일명 | 파일명의 문항 수 | 뽑은 문항 수 | 마지막 번호 | 번호 연속 | 일치(O/X) |")
    print("|---|---:|---:|---:|:---:|:---:|")
    for result in results:
        print(
            f"| {result['파일명']} | {result['파일명의 문항 수']} | "
            f"{result['뽑은 문항 수']} | {result['마지막 번호']} | "
            f"{result['번호 연속']} | {result['일치']} |"
        )


def main():
    """PDF 3건을 분리하고 새 CSV를 만든 뒤 검증 결과를 출력한다."""
    pdf_paths = sorted(SOURCE_DIR.glob("*.pdf"))
    if len(pdf_paths) != 3:
        print(f"오류: 원문 PDF가 3건이어야 하지만 {len(pdf_paths)}건입니다.", file=sys.stderr)
        return 1
    if OUTPUT_PATH.exists():
        print(f"오류: 기존 파일을 고치지 않기 위해 중단합니다: {OUTPUT_PATH}", file=sys.stderr)
        return 1

    all_rows = []
    validation_results = []
    for pdf_path in pdf_paths:
        rows = parse_pdf(pdf_path)
        all_rows.extend(rows)
        validation_results.append(validate_file(pdf_path, rows))

    if any(result["일치"] == "X" for result in validation_results):
        print_validation_table(validation_results)
        print("오류: 문항 수 또는 번호가 일치하지 않아 CSV를 만들지 않았습니다.", file=sys.stderr)
        return 1

    with OUTPUT_PATH.open("x", encoding="utf-8-sig", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(all_rows)

    print_validation_table(validation_results)
    print(f"\n총 {len(all_rows)}개 문항 저장: {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
