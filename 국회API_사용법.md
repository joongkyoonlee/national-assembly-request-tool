# 국회 의안 정리 프로그램 사용법

## 1. 인증키를 넣는 위치

인증키는 `bill_organizer.py` 또는 별도 파일에 적지 않는다. PowerShell의 환경변수 `ASSEMBLY_API_KEY`에 넣고 프로그램이 계속 사용하도록 한다.

현재 PowerShell 창에서만 사용할 때는 다음 순서로 입력한다.

```powershell
$보안키 = Read-Host "국회 API 인증키" -AsSecureString
$env:ASSEMBLY_API_KEY = [Net.NetworkCredential]::new('', $보안키).Password
```

첫 번째 명령을 실행하면 인증키 입력란이 나타난다. 입력한 글자는 화면에 그대로 표시되지 않는다. 환경변수는 현재 PowerShell 창을 닫기 전까지 유지된다.

설정 여부만 확인할 때는 인증키 자체를 출력하지 말고 다음 명령을 사용한다.

```powershell
if ($env:ASSEMBLY_API_KEY) { "인증키 설정됨" } else { "인증키 없음" }
```

## 2. 의안번호 한 건 조회

프로그램이 있는 폴더에서 다음과 같이 실행한다.

```powershell
python .\bill_organizer.py --bill-no 2108120
```

조회 결과는 화면 표로 나오고 `output` 폴더에 `의안정리_실행시각.csv`로 저장된다.

## 3. 전체 의안 조회

```powershell
python .\bill_organizer.py --all
```

전체 조회는 필수 요청인자인 `ERACO`를 기본값 `제22대`로 보낸다. 다른 대수를 조회하려면 다음처럼 지정한다.

```powershell
python .\bill_organizer.py --all --era 21 --max-pages 3
```

의안번호 한 건을 조회할 때는 번호 앞 두 자리로 대수를 자동 판단한다. 예를 들어 `2108120`은 `제21대`로 조회한다.

처음 시험할 때는 호출 범위를 제한하는 것이 안전하다.

```powershell
python .\bill_organizer.py --all --max-pages 3
```

페이지당 요청 수는 1~100 사이에서 조절할 수 있다.

```powershell
python .\bill_organizer.py --all --page-size 100 --max-pages 10
```

## 4. 저장 파일명을 직접 지정

```powershell
python .\bill_organizer.py --bill-no 2108120 --output ".\output\민사소송법_2108120.csv"
```

## 5. 주의사항

- 인증키를 코드, CSV, 메신저, 화면 캡처 또는 공유 폴더에 기록하지 않는다.
- 실제 인증키가 포함된 전체 요청 URL을 출력하거나 공유하지 않는다.
- `INFO-000` 이외의 결과코드가 나오면 메시지를 확인한다.
- 대량 조회 전에는 `--max-pages 1`로 연결과 결과 열을 먼저 점검한다.
- 프로그램은 조회와 정리만 수행하며 국회 시스템에 자료를 제출하거나 수정하지 않는다.
