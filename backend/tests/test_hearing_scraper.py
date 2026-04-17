from datetime import date, time

from app.services.hearing_scraper import _parse_date_time, parse_floor_calendar


# ---------------------------------------------------------------------------
# Committee schedule date/time parser
# ---------------------------------------------------------------------------

def test_parse_date_time_cross_year_january():
    """January hearings in a Dec→Apr scrape should be assigned to the new year."""
    start = date(2025, 12, 1)
    end = date(2026, 4, 30)
    d, t = _parse_date_time("January 15 Wednesday 9:00 AM", start, end)
    assert d == date(2026, 1, 15)
    assert t == time(9, 0)


def test_parse_date_time_cross_year_december():
    """December hearings in a Dec→Apr scrape should stay in the earlier year."""
    start = date(2025, 12, 1)
    end = date(2026, 4, 30)
    d, t = _parse_date_time("December 10 Wednesday 9:00 AM", start, end)
    assert d == date(2025, 12, 10)


def test_parse_date_time_single_year():
    """Single-year range should work as before."""
    start = date(2026, 1, 1)
    end = date(2026, 12, 31)
    d, t = _parse_date_time("March 5 Thursday 1:30 PM", start, end)
    assert d == date(2026, 3, 5)
    assert t == time(13, 30)


def test_parse_date_time_pm_conversion():
    """PM hours should be converted correctly."""
    start = date(2026, 1, 1)
    end = date(2026, 12, 31)
    d, t = _parse_date_time("April 8 Wednesday 12:00 PM", start, end)
    assert t == time(12, 0)

    d, t = _parse_date_time("April 8 Wednesday 12:00 AM", start, end)
    assert t == time(0, 0)


def test_parse_date_time_invalid():
    """Non-date strings should return (None, None)."""
    start = date(2026, 1, 1)
    end = date(2026, 12, 31)
    assert _parse_date_time("No Meeting Scheduled", start, end) == (None, None)
    assert _parse_date_time("", start, end) == (None, None)


# ---------------------------------------------------------------------------
# Floor calendar parser
# ---------------------------------------------------------------------------

_FLOOR_HTML_IN_SESSION = """
<html><body>
<div id="flrCalendar">
  <form>
    <fieldset>
      <div class="area-frame">
        <div class="area-holder">
          <h2 class="title04">SENATE CALENDAR</h2>
          <ul class="list">
            <li style="padding:10px">
              <div style="font-weight:bold">SENATE NOT IN SESSION ON THIS DATE</div>
            </li>
          </ul>
        </div>
        <div class="area-holder">
          <h2 class="title03">HOUSE CALENDAR</h2>
          <ul class="list">
            <li>
              <span class="col01"><a href="http://www.akleg.gov/Basis/Bill/Detail/34?Root=HB  25">HB  25</a></span>
              <span class="col02">DISPOSABLE FOOD SERVICE WARE</span>
              <span class="col03">3RD RDG</span>
              <span class="col04">04/16/26</span>
            </li>
            <li style="padding:10px">
              <div style="font-weight:bold">LEGISLATION HELD FOR RECONSIDERATION</div>
            </li>
            <li>
              <span class="col01"><a href="http://www.akleg.gov/Basis/Bill/Detail/34?Root=HB 263">HB 263</a></span>
              <span class="col02">APPROP: OPERATING BUDGET</span>
              <span class="col03">PASSED ON RECON</span>
              <span class="col04">04/14/26</span>
            </li>
          </ul>
        </div>
      </div>
      <ul class="box-list">
        <li>
          <h2>SENATE</h2>
          <table><tbody><tr><td>ADJOURNED TO 10:00 AM</td></tr></tbody></table>
        </li>
        <li>
          <h2>HOUSE</h2>
          <table><tbody><tr><td>ADJOURNED TO 9:00 AM</td></tr></tbody></table>
        </li>
      </ul>
    </fieldset>
  </form>
</div>
</body></html>
"""

_FLOOR_HTML_BOTH_IN_SESSION = """
<html><body>
<div id="flrCalendar">
  <form>
    <fieldset>
      <div class="area-frame">
        <div class="area-holder">
          <h2 class="title03">HOUSE CALENDAR</h2>
          <ul class="list">
            <li>
              <span class="col01"><a href="http://www.akleg.gov/Basis/Bill/Detail/34?Root=HB 10">HB 10</a></span>
              <span class="col02">SOME BILL</span>
              <span class="col03">3RD RDG</span>
              <span class="col04">04/01/26</span>
            </li>
          </ul>
        </div>
        <div class="area-holder">
          <h2 class="title04">SENATE CALENDAR</h2>
          <ul class="list">
            <li>
              <span class="col01"><a href="http://www.akleg.gov/Basis/Bill/Detail/34?Root=SB  5">SB  5</a></span>
              <span class="col02">ANOTHER BILL</span>
              <span class="col03">2ND RDG</span>
              <span class="col04">04/01/26</span>
            </li>
          </ul>
        </div>
      </div>
      <ul class="box-list">
        <li>
          <h2>HOUSE</h2>
          <table><tbody><tr><td>ADJOURNED TO 1:30 PM</td></tr></tbody></table>
        </li>
        <li>
          <h2>SENATE</h2>
          <table><tbody><tr><td>ADJOURNED TO 2:00 PM</td></tr></tbody></table>
        </li>
      </ul>
    </fieldset>
  </form>
</div>
</body></html>
"""

_FLOOR_HTML_NEITHER_IN_SESSION = """
<html><body>
<div id="flrCalendar">
  <form>
    <fieldset>
      <div class="area-frame">
        <div class="area-holder">
          <h2 class="title03">HOUSE CALENDAR</h2>
          <ul class="list">
            <li><div>HOUSE NOT IN SESSION ON THIS DATE</div></li>
          </ul>
        </div>
        <div class="area-holder">
          <h2 class="title04">SENATE CALENDAR</h2>
          <ul class="list">
            <li><div>SENATE NOT IN SESSION ON THIS DATE</div></li>
          </ul>
        </div>
      </div>
      <ul class="box-list">
        <li>
          <h2>HOUSE</h2>
          <table><tbody><tr><td>ADJOURNED TO 9:00 AM</td></tr></tbody></table>
        </li>
        <li>
          <h2>SENATE</h2>
          <table><tbody><tr><td>ADJOURNED TO 9:00 AM</td></tr></tbody></table>
        </li>
      </ul>
    </fieldset>
  </form>
</div>
</body></html>
"""


def test_floor_calendar_house_in_session_senate_not():
    target = date(2026, 4, 16)
    hearings = parse_floor_calendar(_FLOOR_HTML_IN_SESSION, target)

    assert len(hearings) == 1
    h = hearings[0]
    assert h.chamber == "H"
    assert h.hearing_date == target
    assert h.hearing_time == time(9, 0)

    bill_items = [i for i in h.agenda_items if i.is_bill]
    assert len(bill_items) == 2
    assert bill_items[0].bill_number == "HB 25"
    assert bill_items[0].content == "DISPOSABLE FOOD SERVICE WARE"
    assert bill_items[1].bill_number == "HB 263"

    section_items = [i for i in h.agenda_items if not i.is_bill]
    assert any("RECONSIDERATION" in i.content for i in section_items)


def test_floor_calendar_both_chambers_in_session():
    target = date(2026, 4, 1)
    hearings = parse_floor_calendar(_FLOOR_HTML_BOTH_IN_SESSION, target)

    assert len(hearings) == 2
    chambers = {h.chamber for h in hearings}
    assert chambers == {"H", "S"}

    house = next(h for h in hearings if h.chamber == "H")
    assert house.hearing_time == time(13, 30)

    senate = next(h for h in hearings if h.chamber == "S")
    assert senate.hearing_time == time(14, 0)


def test_floor_calendar_neither_chamber_in_session():
    target = date(2026, 4, 5)
    hearings = parse_floor_calendar(_FLOOR_HTML_NEITHER_IN_SESSION, target)
    assert hearings == []


def test_floor_calendar_no_flr_element():
    hearings = parse_floor_calendar("<html><body></body></html>", date(2026, 4, 1))
    assert hearings == []
