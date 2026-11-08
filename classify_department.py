"""요구 문항 하나를 받아 처리지침에 맞는 소관 과 후보를 알려 주는 분류기."""

import csv
import re
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parent / "data"
ORGANIZATION_FILE = DATA_DIR / "A부_조직도_26개과.csv"
RULE_FILE = DATA_DIR / "배분기준표_소관키워드_304건.csv"
TEST_FILE = DATA_DIR / "시험_요구문항_40건.csv"


def _read_csv(path):
    """UTF-8 CSV 파일을 사전 목록으로 읽는다."""
    with path.open(encoding="utf-8-sig", newline="") as csv_file:
        return list(csv.DictReader(csv_file))


def _normalize(text):
    """공백과 영문 대소문자 차이를 없애 비교하기 쉽게 만든다."""
    return re.sub(r"\s+", "", str(text)).lower()


def classify_department(requirement):
    """소관 과를 반환하며, 동순위 또는 미일치 문항은 '확인필요'로 표시한다."""
    text = _normalize(requirement)
    valid_departments = {row["과"] for row in _read_csv(ORGANIZATION_FILE)}
    candidates = {}

    for rule in _read_csv(RULE_FILE):
        department = rule["과"].strip()
        keyword = _normalize(rule["키워드"])
        exclusions = [
            _normalize(word)
            for word in rule.get("제외어", "").split("|")
            if word.strip()
        ]

        if department not in valid_departments or not keyword:
            continue
        if keyword not in text or any(word in text for word in exclusions):
            continue

        priority = int(rule.get("우선순위") or 999)
        candidates[department] = min(candidates.get(department, 999), priority)

    if not candidates:
        return "확인필요"

    highest_priority = min(candidates.values())
    top_departments = sorted(
        department
        for department, priority in candidates.items()
        if priority == highest_priority
    )

    if len(top_departments) == 1:
        return top_departments[0]

    return f"확인필요: {' | '.join(top_departments)}"


def run_test():
    """제공된 40건 시험자료로 1순위 정답 수를 계산한다."""
    test_rows = _read_csv(TEST_FILE)
    correct = sum(
        classify_department(row["요구내용"]) == row["정답_배분과"]
        for row in test_rows
    )
    print(f"1순위 정답: {correct}/{len(test_rows)}")
    print(f"만든 파일: {Path(__file__).name}")


if __name__ == "__main__":
    run_test()
