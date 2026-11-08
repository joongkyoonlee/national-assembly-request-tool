import csv  # CSV 파일을 사전 형태로 읽기 위해 csv 모듈을 불러옵니다.
import sys  # 한글 출력 인코딩을 명시하기 위해 sys 모듈을 불러옵니다.
from collections import Counter  # 실국별 과 개수를 간편하게 세기 위해 Counter를 불러옵니다.
from pathlib import Path  # 운영체제와 관계없이 안전하게 파일 경로를 다루기 위해 Path를 불러옵니다.

sys.stdout.reconfigure(encoding="utf-8")  # Windows 화면에서도 한글이 깨지지 않도록 출력 인코딩을 UTF-8로 지정합니다.
csv_path = Path(__file__).parent / "data" / "A부_조직도_26개과.csv"  # 파이썬 파일 위치를 기준으로 CSV 파일 경로를 만듭니다.
department_counts = Counter()  # 실국별 과 개수를 저장할 빈 카운터를 만듭니다.

with csv_path.open(mode="r", encoding="utf-8-sig", newline="") as csv_file:  # CSV 파일을 UTF-8 형식으로 열고 작업이 끝나면 자동으로 닫습니다.
    reader = csv.DictReader(csv_file)  # 각 행을 열 이름이 키인 사전으로 읽는 DictReader를 만듭니다.
    for row in reader:  # CSV 파일의 데이터 행을 한 줄씩 반복해서 읽습니다.
        department_counts[row["실국"]] += 1  # 현재 행의 실국에 속한 과 개수를 1만큼 늘립니다.

print("| 실국 | 과 개수 |")  # 표의 열 제목을 화면에 출력합니다.
print("|---|---:|")  # 실국은 왼쪽, 과 개수는 오른쪽 정렬이 되도록 표 구분선을 출력합니다.
for office, count in department_counts.items():  # CSV에 나온 순서대로 실국명과 과 개수를 반복해서 가져옵니다.
    print(f"| {office} | {count} |")  # 현재 실국명과 과 개수를 표의 한 행으로 출력합니다.
print(f"| 합계 | {sum(department_counts.values())} |")  # 전체 과 개수의 합계를 표의 마지막 행으로 출력합니다.
