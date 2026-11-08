"""bill_organizer의 응답 분석과 정리 기능을 실제 인증키 없이 시험합니다."""

import unittest

from bill_organizer import build_url, extract_result, normalize_era, organize_row


SAMPLE_RESPONSE = {
    "ALLBILLV2": [
        {
            "head": [
                {"list_total_count": 1},
                {"RESULT": {"CODE": "INFO-000", "MESSAGE": "정상 처리되었습니다."}},
            ]
        },
        {
            "row": [
                {
                    "ERACO": "제21대",
                    "BILL_NO": "2108120",
                    "BILL_NM": "민사소송법 일부개정법률안",
                    "PPSR_NM": "이수진의원 등 47인",
                    "JRCMIT_NM": "법제사법위원회",
                    "RGS_CONF_RSLT": "임기만료폐기",
                }
            ]
        },
    ]
}


class BillOrganizerTest(unittest.TestCase):
    def test_url_encodes_api_parameters(self):
        url = build_url("test key", 1, 100, "제21대", "2108120")
        self.assertIn("KEY=test+key", url)
        self.assertIn("BILL_NO=2108120", url)
        self.assertIn("ERACO=%EC%A0%9C21%EB%8C%80", url)

    def test_infers_era_from_bill_number(self):
        self.assertEqual(normalize_era("제22대", "2108120"), "제21대")
        self.assertEqual(normalize_era("22"), "제22대")

    def test_extracts_rows_from_assembly_json(self):
        total_count, rows = extract_result(SAMPLE_RESPONSE)
        self.assertEqual(total_count, 1)
        self.assertEqual(rows[0]["BILL_NO"], "2108120")

    def test_changes_api_fields_to_korean_columns(self):
        _, rows = extract_result(SAMPLE_RESPONSE)
        organized = organize_row(rows[0])
        self.assertEqual(organized["의안명"], "민사소송법 일부개정법률안")
        self.assertEqual(organized["본회의처리결과"], "임기만료폐기")

    def test_reports_top_level_api_error(self):
        error_response = {
            "RESULT": {
                "CODE": "ERROR-290",
                "MESSAGE": "인증키가 유효하지 않습니다.",
            }
        }
        with self.assertRaisesRegex(RuntimeError, "ERROR-290.*인증키가 유효하지 않습니다"):
            extract_result(error_response)


if __name__ == "__main__":
    unittest.main()
