from datetime import date, time

from app.services.meeting_scraper import _parse_date_time


def test_parse_date_time_cross_year_january():
    """January meetings in a Dec→Apr scrape should be assigned to the new year."""
    start = date(2025, 12, 1)
    end = date(2026, 4, 30)
    d, t = _parse_date_time("January 15 Wednesday 9:00 AM", start, end)
    assert d == date(2026, 1, 15)
    assert t == time(9, 0)


def test_parse_date_time_cross_year_december():
    """December meetings in a Dec→Apr scrape should stay in the earlier year."""
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
