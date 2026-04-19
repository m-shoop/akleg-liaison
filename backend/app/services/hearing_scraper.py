"""
Scraper for Alaska Legislature hearing schedules.

Committee hearings
------------------
Schedule pages live at:
  https://akleg.gov/index.php?tab2=type%3DAll%26com%3D%26startDate%3DM%2FD%2FYYYY%26endDate%3DM%2FD%2FYYYY%26chamber%3D#tab2

Each hearing is a group of HTML rows starting with a header row whose first
cell matches "(H)COMMITTEENAME" or "(S)COMMITTEENAME". Subsequent rows belong
to that hearing until the next header row.

Floor hearings
--------------
Floor calendar pages live at:
  https://akleg.gov/index.php?tab3=flrDate%3DM%2FD%2FYYYY#tab3

The element //*[@id="flrCalendar"]/form contains the full calendar.
Within the form, each chamber appears as a ``div.area-holder`` identified by
``h2.title03`` (HOUSE CALENDAR) or ``h2.title04`` (SENATE CALENDAR), with
agenda items in a ``ul.list``. Adjournment times are in ``ul.box-list > li``.

If a chamber's only section header reads "HOUSE/SENATE NOT IN SESSION ON THIS
DATE" (and there are no bill rows), that chamber is skipped entirely.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Tag

BASE_URL = "https://akleg.gov"

_HEADER_RE = re.compile(r"^\(([A-Z])\)(.+)")
_BILL_RE = re.compile(r"\b([HS](?:JR|CR|[BR]))\s+(\d+)\b", re.IGNORECASE)
_DATE_RE = re.compile(
    r"^([A-Za-z]+)\s+(\d+)\s+[A-Za-z]+\s+(\d+):(\d+)\s*(AM|PM)", re.IGNORECASE
)
_FLOOR_TIME_RE = re.compile(r"(\d+):(\d+)\s*(AM|PM)", re.IGNORECASE)
_COMMITTEE_CODE_RE = re.compile(r"[?&]code=([A-Z0-9]+)", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Raw data containers
# ---------------------------------------------------------------------------

@dataclass
class ScrapedAgendaItem:
    content: str
    is_bill: bool
    bill_number: str | None = None
    url: str | None = None
    is_teleconferenced: bool = False
    prefix: str | None = None
    context_bill_number: str | None = None


@dataclass
class ScrapedCommitteeHearing:
    chamber: str
    committee_name: str
    committee_type: str
    committee_code: str | None
    committee_url: str | None
    hearing_date: date | None
    hearing_time: time | None
    location: str | None
    agenda_items: list[ScrapedAgendaItem] = field(default_factory=list)


@dataclass
class ScrapedFloorHearing:
    chamber: str        # "H" or "S"
    hearing_date: date
    hearing_time: time | None
    agenda_items: list[ScrapedAgendaItem] = field(default_factory=list)


# ---------------------------------------------------------------------------
# URL builders
# ---------------------------------------------------------------------------

def build_committee_schedule_url(start: date, end: date) -> str:
    value = (
        f"type%3DAll%26com%3D%26"
        f"startDate%3D{start.month}%2F{start.day}%2F{start.year}%26"
        f"endDate%3D{end.month}%2F{end.day}%2F{end.year}%26"
        f"chamber%3D"
    )
    return f"{BASE_URL}/index.php?tab2={value}#tab2"


def build_floor_calendar_url(target_date: date) -> str:
    return (
        f"https://www.akleg.gov/basis/floor.asp"
        f"?Date={target_date.month}%2F{target_date.day}%2F{target_date.year}"
        f"&chamber="
    )


# ---------------------------------------------------------------------------
# Fetch helpers
# ---------------------------------------------------------------------------

async def fetch_committee_schedule_html(start: date, end: date) -> str:
    """Fetch the committee schedule page using Playwright."""
    from playwright.async_api import async_playwright

    url = build_committee_schedule_url(start, end)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=90_000)
        try:
            await page.wait_for_selector(
                "#IndexResults2 > div > table", timeout=15_000
            )
        except Exception:
            pass
        html = await page.content()
        await browser.close()
    return html


async def fetch_floor_calendar_html(target_date: date) -> str:
    """Fetch the floor calendar page for a single date using Playwright."""
    from playwright.async_api import async_playwright

    url = build_floor_calendar_url(target_date)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=90_000)
        try:
            await page.wait_for_selector("#flrCalendar form", timeout=15_000)
        except Exception:
            pass
        html = await page.content()
        await browser.close()
    return html


# ---------------------------------------------------------------------------
# Committee hearing parser
# ---------------------------------------------------------------------------

def parse_committee_schedule(
    html: str, start: date, end: date
) -> list[ScrapedCommitteeHearing]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("#IndexResults2 > div > table")
    if table is None:
        return []
    return _parse_committee_table(table, start, end)


def _parse_committee_table(
    table: Tag, start: date, end: date
) -> list[ScrapedCommitteeHearing]:
    hearings: list[ScrapedCommitteeHearing] = []
    current: ScrapedCommitteeHearing | None = None

    for tr in table.find_all("tr"):
        raw_cells = tr.find_all(["th", "td"])
        if not raw_cells:
            continue

        first_text = raw_cells[0].get_text(strip=True)
        m = _HEADER_RE.match(first_text)

        if m:
            current = _parse_committee_header_row(raw_cells, m)
            hearings.append(current)
            continue

        if current is None:
            continue

        first_colspan = int(raw_cells[0].get("colspan", 1))

        if first_colspan > 1:
            date_text = raw_cells[0].get_text(strip=True)
            location_text = raw_cells[1].get_text(strip=True) if len(raw_cells) > 1 else None
            parsed_date, parsed_time = _parse_date_time(date_text, start, end)
            if parsed_date:
                current.hearing_date = parsed_date
                current.hearing_time = parsed_time
            if location_text:
                current.location = location_text
            continue

        cells, row_prefix = _extract_cells(raw_cells)
        if not cells:
            continue

        first_cell = cells[0]
        bill_match = _BILL_RE.search(first_cell.text)

        if bill_match and first_cell.href:
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
            content = first_cell.text
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
                        context_bill_number=getattr(
                            current, "_current_bill_number", None
                        ),
                    )
                )

    return hearings


@dataclass
class _Cell:
    text: str
    href: str | None = None


def _extract_cells(raw_cells: list) -> tuple[list[_Cell], str | None]:
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


def _parse_committee_header_row(
    raw_cells: list, m: re.Match
) -> ScrapedCommitteeHearing:
    chamber = m.group(1)
    committee_name = m.group(2).strip()

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

    return ScrapedCommitteeHearing(
        chamber=chamber,
        committee_name=committee_name,
        committee_type=committee_type or "Committee",
        committee_code=committee_code,
        committee_url=committee_url,
        hearing_date=None,
        hearing_time=None,
        location=None,
    )


def _parse_date_time(
    text: str, start: date, end: date
) -> tuple[date | None, time | None]:
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
        t = time(hour, minute)
        for year in range(start.year, end.year + 1):
            try:
                d = date(year, month, day)
                if start <= d <= end:
                    return d, t
            except ValueError:
                continue
        return date(start.year, month, day), t
    except (ValueError, OverflowError):
        return None, None


# ---------------------------------------------------------------------------
# Floor hearing parser
# ---------------------------------------------------------------------------

def parse_floor_calendar(
    html: str, target_date: date
) -> list[ScrapedFloorHearing]:
    """Parse the floor calendar HTML for a specific date.

    Returns 0, 1, or 2 ScrapedFloorHearing objects (one per chamber that is
    in session on that date).

    Page structure (real akleg.gov):
    - Bill sections: ``div.area-holder`` with ``h2.title03`` (HOUSE CALENDAR)
      or ``h2.title04`` (SENATE CALENDAR), followed by ``ul.list > li``.
    - Timing: ``ul.box-list > li`` with ``h2 "HOUSE"/"SENATE"`` and a table
      cell containing text like "ADJOURNED TO 10:30 AM".
    """
    soup = BeautifulSoup(html, "html.parser")
    form = soup.select_one("#flrCalendar form")
    if form is None:
        return []

    # ── 1. Build time map from ul.box-list ───────────────────────────────────
    # Each li has <h2>HOUSE</h2> or <h2>SENATE</h2> and a table whose cells
    # may contain "ADJOURNED TO X:XX AM/PM".
    chamber_time: dict[str, time | None] = {}
    box_list = form.find("ul", class_="box-list")
    if box_list:
        for li in box_list.find_all("li", recursive=False):
            h2 = li.find("h2")
            if h2 is None:
                continue
            h2_text = h2.get_text(strip=True).upper()
            if "HOUSE" in h2_text:
                ch = "H"
            elif "SENATE" in h2_text:
                ch = "S"
            else:
                continue
            hearing_time_val: time | None = None
            table = li.find("table")
            if table:
                for td in table.find_all("td"):
                    tm = _FLOOR_TIME_RE.search(td.get_text(strip=True))
                    if tm:
                        hour = int(tm.group(1))
                        minute = int(tm.group(2))
                        ampm = tm.group(3).upper()
                        if ampm == "PM" and hour != 12:
                            hour += 12
                        elif ampm == "AM" and hour == 12:
                            hour = 0
                        try:
                            hearing_time_val = time(hour, minute)
                        except ValueError:
                            pass
                        break
            chamber_time[ch] = hearing_time_val

    # ── 2. Parse bill sections from div.area-holder ──────────────────────────
    hearings: list[ScrapedFloorHearing] = []

    for area in form.find_all("div", class_="area-holder"):
        h2 = area.find("h2")
        if h2 is None:
            continue
        h2_text = h2.get_text(strip=True).upper()
        if "HOUSE" in h2_text:
            chamber = "H"
        elif "SENATE" in h2_text:
            chamber = "S"
        else:
            continue

        agenda_list = area.find("ul", class_="list")
        if agenda_list is None:
            continue

        all_items = agenda_list.find_all("li", recursive=False)

        # Decide whether the chamber is in session.
        section_headers: list[str] = []
        has_bill_rows = False
        for item in all_items:
            col01 = item.find("span", class_="col01")
            if col01 is not None:
                bill_match = _BILL_RE.search(col01.get_text(strip=True))
                link = col01.find("a")
                if bill_match and link:
                    has_bill_rows = True
            else:
                div = item.find("div")
                if div:
                    section_headers.append(div.get_text(strip=True).upper())

        # Skip if the only content is a "NOT IN SESSION" header.
        if (
            not has_bill_rows
            and len(section_headers) == 1
            and "NOT IN SESSION" in section_headers[0]
        ):
            continue

        # ── Parse agenda items ────────────────────────────────────────────
        agenda_items: list[ScrapedAgendaItem] = []
        current_bill_number: str | None = None

        for item in all_items:
            col01 = item.find("span", class_="col01")
            col02 = item.find("span", class_="col02")

            if col01 is not None:
                link = col01.find("a")
                bill_match = _BILL_RE.search(col01.get_text(strip=True))

                if bill_match and link:
                    bill_number = (
                        f"{bill_match.group(1).upper()} {bill_match.group(2)}"
                    )
                    description = col02.get_text(strip=True) if col02 else bill_number
                    url = _absolutify(link.get("href"))
                    current_bill_number = bill_number
                    agenda_items.append(
                        ScrapedAgendaItem(
                            content=description,
                            is_bill=True,
                            bill_number=bill_number,
                            url=url,
                        )
                    )
                else:
                    content = col02.get_text(strip=True) if col02 else col01.get_text(strip=True)
                    if content:
                        agenda_items.append(
                            ScrapedAgendaItem(
                                content=content,
                                is_bill=False,
                                context_bill_number=current_bill_number,
                            )
                        )
            else:
                div = item.find("div")
                if div:
                    content = div.get_text(strip=True)
                    if content:
                        agenda_items.append(
                            ScrapedAgendaItem(content=content, is_bill=False)
                        )
                        current_bill_number = None

        hearings.append(
            ScrapedFloorHearing(
                chamber=chamber,
                hearing_date=target_date,
                hearing_time=chamber_time.get(chamber),
                agenda_items=agenda_items,
            )
        )

    return hearings


# ---------------------------------------------------------------------------
# Helpers shared by both parsers
# ---------------------------------------------------------------------------

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

async def scrape_and_store_hearings(
    db,
    start: date,
    end: date,
    legislature_session: int,
) -> int:
    """Fetch, parse, and persist committee and floor hearings for a date range.

    Returns the total count of hearings saved.  After upserting all scraped
    hearings, any previously active hearing in the date range that was not
    found in the current scrape is marked inactive.
    """
    from app.repositories.bill_repository import get_bill_by_number
    from app.repositories.hearing_repository import (
        deactivate_removed_hearings,
        replace_agenda_items,
        upsert_committee_hearing,
        upsert_floor_hearing,
    )

    saved = 0
    active_ids: set[int] = set()

    # ── Committee hearings ────────────────────────────────────────────────
    committee_html = await fetch_committee_schedule_html(start, end)
    committee_hearings = parse_committee_schedule(committee_html, start=start, end=end)

    for h in committee_hearings:
        if h.hearing_date is None:
            continue

        hearing_id = await upsert_committee_hearing(
            db,
            chamber=h.chamber,
            committee_name=h.committee_name,
            committee_type=h.committee_type,
            committee_code=h.committee_code,
            committee_url=h.committee_url,
            hearing_date=h.hearing_date,
            hearing_time=h.hearing_time,
            location=h.location,
            legislature_session=legislature_session,
        )
        active_ids.add(hearing_id)

        bill_id_cache: dict[str, int | None] = {}
        agenda_rows: list[dict] = []

        for i, item in enumerate(h.agenda_items):
            ref_number = item.bill_number if item.is_bill else item.context_bill_number
            bill_id = None
            if ref_number:
                if ref_number not in bill_id_cache:
                    db_bill = await get_bill_by_number(db, ref_number, legislature_session)
                    bill_id_cache[ref_number] = db_bill.id if db_bill else None
                bill_id = bill_id_cache[ref_number]

            agenda_rows.append({
                "bill_number": ref_number,
                "bill_id": bill_id,
                "content": item.content,
                "url": item.url,
                "is_bill": item.is_bill,
                "is_teleconferenced": item.is_teleconferenced,
                "prefix": item.prefix,
                "sort_order": i,
            })

        await replace_agenda_items(db, hearing_id, agenda_rows)
        saved += 1

    # ── Floor hearings — one fetch per date in the range ─────────────────
    current_date = start
    while current_date <= end:
        floor_html = await fetch_floor_calendar_html(current_date)
        floor_hearings = parse_floor_calendar(floor_html, current_date)

        for fh in floor_hearings:
            hearing_id = await upsert_floor_hearing(
                db,
                chamber=fh.chamber,
                hearing_date=fh.hearing_date,
                hearing_time=fh.hearing_time,
                location=None,
                legislature_session=legislature_session,
            )
            active_ids.add(hearing_id)

            bill_id_cache = {}
            agenda_rows = []

            for i, item in enumerate(fh.agenda_items):
                ref_number = (
                    item.bill_number if item.is_bill else item.context_bill_number
                )
                bill_id = None
                if ref_number:
                    if ref_number not in bill_id_cache:
                        db_bill = await get_bill_by_number(
                            db, ref_number, legislature_session
                        )
                        bill_id_cache[ref_number] = db_bill.id if db_bill else None
                    bill_id = bill_id_cache[ref_number]

                agenda_rows.append({
                    "bill_number": ref_number,
                    "bill_id": bill_id,
                    "content": item.content,
                    "url": item.url,
                    "is_bill": item.is_bill,
                    "is_teleconferenced": False,
                    "prefix": item.prefix,
                    "sort_order": i,
                })

            await replace_agenda_items(db, hearing_id, agenda_rows)
            saved += 1

        current_date += timedelta(days=1)

    # Deactivate hearings in the range not returned by this scrape.
    # Guard: if both scrapers returned nothing, the page likely failed —
    # skip deactivation to avoid wiping existing data.
    if committee_hearings or saved > 0:
        await deactivate_removed_hearings(
            db, start, end, legislature_session, active_ids
        )

    await db.commit()
    return saved
