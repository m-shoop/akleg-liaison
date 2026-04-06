"""
Unit tests for fiscal_note_sync parsing helpers.

These tests cover pure functions only — no database, network, or Playwright.
"""

from datetime import date

import pytest

from app.services.fiscal_note_sync import (
    _bill_number_to_url_id,
    _parse_fiscal_note_links,
    _parse_select_bill_calls,
    _parse_text_fields,
    _url_id_to_bill_number,
)


# ---------------------------------------------------------------------------
# _url_id_to_bill_number
# ---------------------------------------------------------------------------

class TestUrlIdToBillNumber:
    def test_house_bill_single_digit(self):
        assert _url_id_to_bill_number("HB____1") == "HB 1"

    def test_house_bill_two_digits(self):
        assert _url_id_to_bill_number("HB___12") == "HB 12"

    def test_house_bill_three_digits(self):
        assert _url_id_to_bill_number("HB__123") == "HB 123"

    def test_senate_bill(self):
        assert _url_id_to_bill_number("SB___45") == "SB 45"

    def test_no_padding(self):
        assert _url_id_to_bill_number("HB1") == "HB1"


# ---------------------------------------------------------------------------
# _bill_number_to_url_id
# ---------------------------------------------------------------------------

class TestBillNumberToUrlId:
    def test_house_bill_single_digit(self):
        assert _bill_number_to_url_id("HB 1") == "HB____1"

    def test_house_bill_two_digits(self):
        assert _bill_number_to_url_id("HB 12") == "HB___12"

    def test_house_bill_three_digits(self):
        assert _bill_number_to_url_id("HB 123") == "HB__123"

    def test_senate_bill_single_digit(self):
        assert _bill_number_to_url_id("SB 2") == "SB____2"

    def test_senate_bill_two_digits(self):
        assert _bill_number_to_url_id("SB 45") == "SB___45"

    def test_roundtrip(self):
        """Converting to URL ID and back should return the original bill number."""
        for bill_number in ("HB 1", "HB 12", "HB 123", "SB 2", "SB 45"):
            assert _url_id_to_bill_number(_bill_number_to_url_id(bill_number)) == bill_number


# ---------------------------------------------------------------------------
# _parse_select_bill_calls
# ---------------------------------------------------------------------------

_ALL_NOTES_HTML = r"""
<html><body>
<table>
  <tr><td width="200"><b><a href="#" id="billHB____1" onclick="selectBill('HB____1','N','HFIN','','')">HB    1 - \N</a></b></td><td> (HFIN)</td></tr>
  <tr><td colspan="4"><div id="billHB____1N"></div></td></tr>
  <tr><td width="200"><b><a href="#" id="billHB___12" onclick="selectBill('HB___12','A','HEDC','','')">HB   12</a></b></td><td> (HEDC)</td></tr>
  <tr><td colspan="4"><div id="billHB___12A"></div></td></tr>
  <tr><td width="200"><b><a href="#" id="billSB___55" onclick="selectBill('SB___55','N','SFIN','','')">SB   55</a></b></td><td> (SFIN)</td></tr>
  <tr><td colspan="4"><div id="billSB___55N"></div></td></tr>
</table>
</body></html>
"""


class TestParseSelectBillCalls:
    def test_returns_all_entries(self):
        entries = _parse_select_bill_calls(_ALL_NOTES_HTML)
        assert len(entries) == 3

    def test_first_entry_fields(self):
        entries = _parse_select_bill_calls(_ALL_NOTES_HTML)
        assert entries[0] == {
            "bill_url_id": "HB____1",
            "bill_version": "N",
            "committee": "HFIN",
        }

    def test_second_entry_fields(self):
        entries = _parse_select_bill_calls(_ALL_NOTES_HTML)
        assert entries[1] == {
            "bill_url_id": "HB___12",
            "bill_version": "A",
            "committee": "HEDC",
        }

    def test_senate_entry(self):
        entries = _parse_select_bill_calls(_ALL_NOTES_HTML)
        assert entries[2]["bill_url_id"] == "SB___55"
        assert entries[2]["committee"] == "SFIN"

    def test_empty_html(self):
        assert _parse_select_bill_calls("<html></html>") == []


# ---------------------------------------------------------------------------
# _parse_fiscal_note_links
# ---------------------------------------------------------------------------

# Representative allNotesBill.php HTML fragment.
# Two departments; the second has two appropriation/allocation pairs under it
# (the Department of Health pattern from the real site).
_ALL_NOTES_BILL_HTML = (
    "&nbsp;&nbsp;<b>Department of Administration</b><br>"
    "&nbsp;&nbsp;&nbsp;&nbsp;Centralized Administrative Services<br>"
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Finance<br>"
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
    '<a href="fiscalNote.php?q=&amp;billID=HB____1&amp;billVersion=N&amp;compNum=59&amp;session=34&amp;sid=722474188" target="_blank">View Note</a>'
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<br>"
    "&nbsp;&nbsp;<b>Department of Health</b><br>"
    "&nbsp;&nbsp;&nbsp;&nbsp;Behavioral Health<br>"
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Behavioral Health Administration<br>"
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
    '<a href="fiscalNote.php?q=&amp;billID=HB____1&amp;billVersion=N&amp;compNum=2614&amp;session=34&amp;sid=1977336702" target="_blank">View Note</a>'
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<br>"
    "&nbsp;&nbsp;&nbsp;&nbsp;Health Care Services<br>"
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Medical Assistance Administration<br>"
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"
    '<a href="fiscalNote.php?q=&amp;billID=HB____1&amp;billVersion=N&amp;compNum=242&amp;session=34&amp;sid=815775190" target="_blank">View Note</a>'
    "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<br>"
)


class TestParseFiscalNoteLinks:
    def test_returns_all_links(self):
        links = _parse_fiscal_note_links(_ALL_NOTES_BILL_HTML)
        assert len(links) == 3

    def test_first_link_sid(self):
        links = _parse_fiscal_note_links(_ALL_NOTES_BILL_HTML)
        assert links[0]["session_id"] == "722474188"

    def test_url_is_absolute(self):
        links = _parse_fiscal_note_links(_ALL_NOTES_BILL_HTML)
        assert links[0]["url"].startswith("https://")
        assert "fiscalNote.php" in links[0]["url"]

    def test_first_link_department(self):
        links = _parse_fiscal_note_links(_ALL_NOTES_BILL_HTML)
        assert links[0]["fn_department"] == "Department of Administration"

    def test_first_link_appropriation(self):
        links = _parse_fiscal_note_links(_ALL_NOTES_BILL_HTML)
        assert links[0]["fn_appropriation"] == "Centralized Administrative Services"

    def test_first_link_allocation(self):
        links = _parse_fiscal_note_links(_ALL_NOTES_BILL_HTML)
        assert links[0]["fn_allocation"] == "Finance"

    def test_second_link_same_department_different_appropriation(self):
        """Two notes under the same department pick up the correct appropriation each."""
        links = _parse_fiscal_note_links(_ALL_NOTES_BILL_HTML)
        assert links[1]["fn_department"] == "Department of Health"
        assert links[1]["fn_appropriation"] == "Behavioral Health"
        assert links[1]["fn_allocation"] == "Behavioral Health Administration"

    def test_third_link_same_department_different_appropriation(self):
        links = _parse_fiscal_note_links(_ALL_NOTES_BILL_HTML)
        assert links[2]["fn_department"] == "Department of Health"
        assert links[2]["fn_appropriation"] == "Health Care Services"
        assert links[2]["fn_allocation"] == "Medical Assistance Administration"

    def test_empty_response(self):
        assert _parse_fiscal_note_links("") == []

    def test_no_fiscal_note_links(self):
        assert _parse_fiscal_note_links("<div>No fiscal notes.</div>") == []


# ---------------------------------------------------------------------------
# _parse_pdf_fields
# ---------------------------------------------------------------------------

# Minimal representative text as extracted by pdfplumber from a real fiscal note.
_PDF_TEXT = """
Fiscal Note
State of Alaska
Bill Version: HB 12
Fiscal Note Number:
() Publish Date: 03/07/2026
2026 Legislative Session
Identifier: HB012-EED-CN-3-07-26
Title: FREE BREAKFAST & LUNCH IN PUBLIC SCHOOLS
Sponsor: DIBERT
Requester: (H) Education
Department: Department of Education and Early Development
Appropriation: Education Support and Admin Services
Allocation: Child Nutrition
OMB Component Number: 1955
Printed 4/5/2026  Page 1 of 2  Control Code: qrsTK
"""

_PDF_TEXT_NO_PUBLISH_DATE = """
Identifier: HB062-DOC-ADM-1-15-26
Department: Department of Corrections
() Publish Date:
Printed 4/5/2026  Page 1 of 2  Control Code: abcXY
"""

_PDF_TEXT_MULTI_PAGE = """
Identifier: SB045-DOA-FIN-2-20-26
Department: Department of Administration
() Publish Date: 01/15/2026
Printed 4/5/2026  Page 1 of 2  Control Code: firstCC
Printed 4/5/2026  Page 2 of 2  Control Code: lastCC
"""

class TestParseTextFields:
    def test_fn_identifier(self):
        result = _parse_text_fields(_PDF_TEXT)
        assert result["fn_identifier"] == "HB012-EED-CN-3-07-26"

    def test_control_code(self):
        result = _parse_text_fields(_PDF_TEXT)
        assert result["control_code"] == "qrsTK"

    def test_publish_date_parsed(self):
        result = _parse_text_fields(_PDF_TEXT)
        assert result["publish_date"] == date(2026, 3, 7)

    def test_publish_date_empty_returns_none(self):
        result = _parse_text_fields(_PDF_TEXT_NO_PUBLISH_DATE)
        assert result["publish_date"] is None

    def test_control_code_takes_last_on_multipage(self):
        result = _parse_text_fields(_PDF_TEXT_MULTI_PAGE)
        assert result["control_code"] == "lastCC"

    def test_missing_fields_return_none(self):
        result = _parse_text_fields("Nothing useful here.")
        assert result["fn_identifier"] is None
        assert result["control_code"] is None
        assert result["publish_date"] is None
