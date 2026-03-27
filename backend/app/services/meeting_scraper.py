"""
Scraper for Alaska Legislature committee meeting schedules.

Schedule pages live at:
  https://akleg.gov/index.php?tab2=type%3DAll%26com%3D%26startDate%3DM%2FD%2FYYYY%26endDate%3DM%2FD%2FYYYY%26chamber%3D#tab2

Each meeting is a group of HTML rows starting with a header row whose first
cell matches "(H)COMMITTEENAME" or "(S)COMMITTEENAME".  Subsequent rows belong
to that meeting until the next header row.

Row types after the header
--------------------------
date/location row  — first cell has colspan=2 and contains a date string like
                     "May 20 Tuesday 9:00 AM"; second cell is the room location.

bill row           — first cell (after the prefix merge done by the site) contains
                     a bill number like "HB 39" or "+= HB 39"; has a URL.

note row           — everything else (e.g. "No Meeting Scheduled").
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Tag

BASE_URL = "https://akleg.gov"

_HEADER_RE = re.compile(r"^\(([A-Z])\)(.+)")
_BILL_RE = re.compile(r"\b([HS]B)\s+(\d+)\b", re.IGNORECASE)
_DATE_RE = re.compile(
    r"^([A-Za-z]+)\s+(\d+)\s+[A-Za-z]+\s+(\d+):(\d+)\s*(AM|PM)", re.IGNORECASE
)
_COMMITTEE_CODE_RE = re.compile(r"[?&]code=([A-Z0-9]+)", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Raw data containers
# ---------------------------------------------------------------------------

@dataclass
class ScrapedAgendaItem:
    content: str            # bill title for bills, note text for annotations
    is_bill: bool
    bill_number: str | None = None   # normalised, e.g. "HB 39"
    url: str | None = None
    is_teleconferenced: bool = False
    prefix: str | None = None        # raw symbol from narrow first column, e.g. "+", "+="
    # bill_number of the bill this note is contextually tied to (if any)
    context_bill_number: str | None = None


@dataclass
class ScrapedMeeting:
    chamber: str            # "H" or "S"
    committee_name: str     # "FINANCE"
    committee_type: str     # "Standing Committee"
    committee_code: str | None
    committee_url: str | None
    meeting_date: date | None
    meeting_time: time | None
    location: str | None
    agenda_items: list[ScrapedAgendaItem] = field(default_factory=list)


# ---------------------------------------------------------------------------
# URL builder
# ---------------------------------------------------------------------------

def build_schedule_url(start: date, end: date) -> str:
    # The tab2 value is itself pre-encoded — build the URL directly to avoid
    # double-encoding via urlencode.
    value = (
        f"type%3DAll%26com%3D%26"
        f"startDate%3D{start.month}%2F{start.day}%2F{start.year}%26"
        f"endDate%3D{end.month}%2F{end.day}%2F{end.year}%26"
        f"chamber%3D"
    )
    return f"{BASE_URL}/index.php?tab2={value}#tab2"


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

async def fetch_schedule_html(start: date, end: date) -> str:
    """Fetch the schedule page using Playwright (async)."""
    from playwright.async_api import async_playwright

    url = build_schedule_url(start, end)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=90_000)
        try:
            await page.wait_for_selector(
                "#IndexResults2 > div > table", timeout=15_000
            )
        except Exception:
            pass  # page may load without results (empty week)
        html = await page.content()
        await browser.close()
    return html


# ---------------------------------------------------------------------------
# Parse
# ---------------------------------------------------------------------------

def parse_schedule(html: str, year: int) -> list[ScrapedMeeting]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("#IndexResults2 > div > table")
    if table is None:
        return []
    return _parse_table(table, year)


def _parse_table(table: Tag, year: int) -> list[ScrapedMeeting]:
    meetings: list[ScrapedMeeting] = []
    current: ScrapedMeeting | None = None

    for tr in table.find_all("tr"):
        raw_cells = tr.find_all(["th", "td"])
        if not raw_cells:
            continue

        first_text = raw_cells[0].get_text(strip=True)
        m = _HEADER_RE.match(first_text)

        if m:
            # --- Header row: start a new meeting ---
            current = _parse_header_row(raw_cells, m)
            meetings.append(current)
            continue

        if current is None:
            continue

        first_colspan = int(raw_cells[0].get("colspan", 1))

        if first_colspan > 1:
            # --- Date / location row ---
            date_text = raw_cells[0].get_text(strip=True)
            location_text = raw_cells[1].get_text(strip=True) if len(raw_cells) > 1 else None
            parsed_date, parsed_time = _parse_date_time(date_text, year)
            if parsed_date:
                current.meeting_date = parsed_date
                current.meeting_time = parsed_time
            if location_text:
                current.location = location_text
            continue

        # Remaining rows: merge prefix col + bill col (same logic as dps-scraper)
        cells, row_prefix = _extract_cells(raw_cells)
        if not cells:
            continue

        first_cell = cells[0]
        bill_match = _BILL_RE.search(first_cell.text)

        if bill_match and first_cell.href:
            # --- Bill row ---
            bill_number = f"{bill_match.group(1).upper()} {bill_match.group(2)}"
            description = cells[1].text if len(cells) > 1 else None
            teleconf_text = cells[2].text if len(cells) > 2 else ""
            is_teleconf = bool(teleconf_text and "TELECONF" in teleconf_text.upper())
            url = _absolutify(first_cell.href)
            current._current_bill_number = bill_number
            current.agenda_items.append(
                ScrapedAgendaItem(
                    content=description or bill_number,
                    is_bill=True,
                    bill_number=bill_number,
                    url=url,
                    is_teleconferenced=is_teleconf,
                    prefix=row_prefix,
                )
            )
        else:
            # --- Note/annotation row ---
            content = first_cell.text
            # If the merged first cell is empty or only contains prefix symbols
            # like "+" / "+=" with no alphanumeric content, the real text is
            # in the next cell (e.g. "Bills Previously Heard/Scheduled").
            if not content or not any(c.isalnum() for c in content):
                content = cells[1].text if len(cells) > 1 else ""
            if content:
                url = _absolutify(first_cell.href) if first_cell.href else None
                teleconf_text = cells[2].text if len(cells) > 2 else ""
                is_teleconf = bool(teleconf_text and "TELECONF" in teleconf_text.upper())
                current.agenda_items.append(
                    ScrapedAgendaItem(
                        content=content,
                        is_bill=False,
                        url=url,
                        prefix=row_prefix,
                        is_teleconferenced=is_teleconf,
                        context_bill_number=getattr(current, "_current_bill_number", None),
                    )
                )

    return meetings


@dataclass
class _Cell:
    text: str
    href: str | None = None


def _extract_cells(raw_cells: list) -> tuple[list[_Cell], str | None]:
    """Mirror dps-scraper's prefix-merge logic.

    Returns (cells, prefix) where prefix is the raw symbol from the narrow
    first column (e.g. "+", "+=", "-") before it is merged away, or None.
    """
    cells = []
    for c in raw_cells:
        link = c.find("a")
        href = link["href"] if link and link.get("href") else None
        cells.append(_Cell(text=c.get_text(strip=True), href=href))

    first_colspan = int(raw_cells[0].get("colspan", 1)) if raw_cells else 1
    prefix: str | None = None
    if len(cells) >= 2 and first_colspan == 1:
        raw_prefix = cells[0].text
        prefix = raw_prefix if raw_prefix else None
        second = cells[1]
        merged_text = f"{raw_prefix} {second.text}".strip() if raw_prefix else second.text
        cells = [_Cell(text=merged_text, href=second.href)] + cells[2:]

    return cells, prefix


def _parse_header_row(raw_cells: list, m: re.Match) -> ScrapedMeeting:
    chamber = m.group(1)
    committee_name = m.group(2).strip()

    # Second cell: committee type + optional link
    committee_type = ""
    committee_url = None
    committee_code = None
    if len(raw_cells) > 1:
        cell2 = raw_cells[1]
        committee_type = cell2.get_text(strip=True).rstrip("*").strip()
        link = cell2.find("a")
        if link and link.get("href"):
            href = link["href"]
            committee_url = _absolutify(href)
            cm = _COMMITTEE_CODE_RE.search(href)
            if cm:
                committee_code = cm.group(1)

    return ScrapedMeeting(
        chamber=chamber,
        committee_name=committee_name,
        committee_type=committee_type or "Committee",
        committee_code=committee_code,
        committee_url=committee_url,
        meeting_date=None,
        meeting_time=None,
        location=None,
    )


def _parse_date_time(text: str, year: int) -> tuple[date | None, time | None]:
    """Parse strings like 'May 20 Tuesday 9:00 AM' into (date, time)."""
    m = _DATE_RE.match(text)
    if not m:
        return None, None
    month_str, day_str, hour_str, minute_str, ampm = m.groups()
    try:
        month = datetime.strptime(month_str[:3], "%b").month
        day = int(day_str)
        hour = int(hour_str)
        minute = int(minute_str)
        if ampm.upper() == "PM" and hour != 12:
            hour += 12
        elif ampm.upper() == "AM" and hour == 12:
            hour = 0
        return date(year, month, day), time(hour, minute)
    except (ValueError, OverflowError):
        return None, None


def _absolutify(href: str | None) -> str | None:
    if not href:
        return None
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("/"):
        return BASE_URL + href
    return href


# ---------------------------------------------------------------------------
# DB persistence
# ---------------------------------------------------------------------------

async def scrape_and_store_meetings(
    db,
    start: date,
    end: date,
    legislature_session: int,
) -> int:
    """Fetch, parse, and persist meetings for a date range. Returns count saved.

    After upserting all scraped meetings, any previously active meeting in the
    date range that was not found in the current scrape is marked inactive.
    """
    from app.repositories.bill_repository import get_bill_by_number
    from app.repositories.meeting_repository import (
        deactivate_removed_meetings,
        replace_agenda_items,
        upsert_meeting,
    )

    html = await fetch_schedule_html(start, end)
    meetings = parse_schedule(html, year=start.year)

    saved = 0
    active_ids: set[int] = set()

    for m in meetings:
        if m.meeting_date is None:
            continue  # skip meetings with no date (cancelled / TBD)

        meeting_id = await upsert_meeting(
            db,
            chamber=m.chamber,
            committee_name=m.committee_name,
            committee_type=m.committee_type,
            committee_code=m.committee_code,
            committee_url=m.committee_url,
            meeting_date=m.meeting_date,
            meeting_time=m.meeting_time,
            location=m.location,
            legislature_session=legislature_session,
        )
        active_ids.add(meeting_id)

        # Build a cache of bill_number → bill_id for this meeting's bills
        bill_id_cache: dict[str, int | None] = {}
        agenda_rows: list[dict] = []

        for i, item in enumerate(m.agenda_items):
            # Resolve the relevant bill number (own for bill rows, context for notes)
            ref_number = item.bill_number if item.is_bill else item.context_bill_number

            bill_id = None
            if ref_number:
                if ref_number not in bill_id_cache:
                    db_bill = await get_bill_by_number(db, ref_number, legislature_session)
                    bill_id_cache[ref_number] = db_bill.id if db_bill else None
                bill_id = bill_id_cache[ref_number]

            agenda_rows.append({
                "meeting_id": meeting_id,
                "bill_number": ref_number,
                "bill_id": bill_id,
                "content": item.content,
                "url": item.url,
                "is_bill": item.is_bill,
                "is_teleconferenced": item.is_teleconferenced,
                "prefix": item.prefix,
                "sort_order": i,
            })

        await replace_agenda_items(db, meeting_id, agenda_rows)

        saved += 1

    # Deactivate any active meeting in the range not returned by this scrape
    await deactivate_removed_meetings(db, start, end, legislature_session, active_ids)

    await db.commit()
    return saved
