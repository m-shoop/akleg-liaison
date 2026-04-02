"""
Scraper for Alaska Legislature bill detail pages.

Bill detail pages live at:
  https://www.akleg.gov/basis/Bill/Detail/{session}?Root={bill_number}
e.g. https://www.akleg.gov/basis/Bill/Detail/34?Root=HB%20%2062

The action history table groups multiple rows under the same logical event
when they share the same (date, source URL).  Each unique (date, source URL)
pair becomes one BillEvent in the database.

Row types
---------
floorAction      — links to a House/Senate Journal page
                   href: /basis/Journal/Pages/{session}?Chamber=H&Bill=...&Page=NNNNN

committeeAction  — links to a Committee Meeting detail page
                   href: /basis/Meeting/Detail/?Meeting=HJUD 2025-02-05 13:00:00&Bill=...
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from itertools import groupby
from urllib.parse import quote, urljoin

from bs4 import BeautifulSoup, Tag

from app.models.bill import Chamber, EventType

BASE_URL = "https://www.akleg.gov"
BILL_DETAIL_PATH = "/basis/Bill/Detail/{session}?Root={bill_number}"
BILL_RANGE_PATH = "/basis/Bill/Range/{session}?session=&bill1=&bill2="

_CHAMBER_RE = re.compile(r"^\(([HS])\)")
_BILL_ROOT_RE = re.compile(r"^([A-Z]+)\s*(\d+)$", re.IGNORECASE)


def build_bill_url(bill_number: str, session: int) -> str:
    encoded = quote(bill_number, safe="")
    return BASE_URL + BILL_DETAIL_PATH.format(session=session, bill_number=encoded)


# ---------------------------------------------------------------------------
# Raw data containers
# ---------------------------------------------------------------------------

@dataclass
class ScrapedSponsor:
    name: str
    chamber: str | None = None
    sponsor_type: str = "primary"


@dataclass
class ScrapedEvent:
    """One logical event = unique (event_date, source_url) pair."""

    event_date: date
    # Absolute URL to the Journal page or Meeting detail
    source_url: str
    event_type: EventType
    chamber: Chamber
    # All action-text lines for this event, joined with " | "
    raw_text: str


@dataclass
class ScrapedKeyword:
    keyword: str
    url: str | None = None


@dataclass
class ScrapedBill:
    bill_number: str
    session: int
    source_url: str
    title: str | None = None
    short_title: str | None = None
    status: str | None = None
    introduced_date: date | None = None
    sponsors: list[ScrapedSponsor] = field(default_factory=list)
    events: list[ScrapedEvent] = field(default_factory=list)
    keywords: list[ScrapedKeyword] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Fetch (Playwright — page requires JavaScript to render)
# ---------------------------------------------------------------------------

async def fetch_bill_html(url: str) -> str:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=90000)
        # Wait for the action rows specifically — there are multiple table.table
        # elements on the page (Full Text, Fiscal Notes, etc.) so we wait for
        # the distinctive row classes used only in the Actions tab.
        await page.wait_for_selector(".floorAction, .committeeAction", timeout=90000)
        html = await page.content()
        await browser.close()
        return html


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _parse_date(text: str) -> date | None:
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%B %d, %Y"):
        try:
            return datetime.strptime(text.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _chamber_from_text(text: str) -> Chamber | None:
    m = _CHAMBER_RE.match(text.strip())
    if m:
        return Chamber.HOUSE if m.group(1) == "H" else Chamber.SENATE
    return None


def _absolute_url(href: str) -> str:
    return urljoin(BASE_URL, href)


# ---------------------------------------------------------------------------
# Action table parsing
# ---------------------------------------------------------------------------

@dataclass
class _RawRow:
    """One <tr> from the actions table before grouping."""
    event_date: date
    source_url: str           # absolute
    event_type: EventType
    chamber: Chamber | None
    text: str


def _parse_action_table(table: Tag) -> list[_RawRow]:
    rows: list[_RawRow] = []

    for tr in table.find_all("tr"):
        # Skip header rows
        if tr.find("th"):
            continue

        cells = tr.find_all("td")
        if len(cells) < 3:
            continue

        # --- Date ---
        time_el = cells[0].find("time")
        if not time_el:
            continue
        event_date = _parse_date(time_el.get("datetime") or time_el.get_text())
        if event_date is None:
            continue

        # --- Source URL (from the link in the page/journal cell) ---
        link = cells[1].find("a")
        if not link or not link.get("href"):
            continue
        source_url = _absolute_url(link["href"])

        # --- Event type from row class ---
        classes = tr.get("class", [])
        if any("committeeAction" in c for c in classes):
            event_type = EventType.COMMITTEE_ACTION
        else:
            event_type = EventType.FLOOR_ACTION

        # --- Text + chamber ---
        text_el = cells[2].find("span", {"data-label": "Text"}) or cells[2]
        raw_text = text_el.get_text(strip=True)
        chamber = _chamber_from_text(raw_text)

        rows.append(_RawRow(
            event_date=event_date,
            source_url=source_url,
            event_type=event_type,
            chamber=chamber,
            text=raw_text,
        ))

    return rows


def _group_into_events(raw_rows: list[_RawRow]) -> list[ScrapedEvent]:
    """
    Collapse rows that share (event_date, source_url) into a single event.
    Multiple rows with the same key carry related text lines for one event.
    """
    # stable grouping — rows arrive in document order
    def key(r: _RawRow) -> tuple:
        return (r.event_date, r.source_url)

    events: list[ScrapedEvent] = []

    for (event_date, source_url), group in groupby(raw_rows, key=key):
        group_list = list(group)
        texts = [r.text for r in group_list]
        raw_text = " | ".join(texts)

        # Determine chamber: first row that has one wins
        chamber = next((r.chamber for r in group_list if r.chamber), None)
        if chamber is None:
            # Fall back: infer from source URL query string (Chamber=H / Chamber=S)
            chamber = (
                Chamber.HOUSE
                if "Chamber=H" in source_url
                else Chamber.SENATE
            )

        event_type = group_list[0].event_type

        events.append(ScrapedEvent(
            event_date=event_date,
            source_url=source_url,
            event_type=event_type,
            chamber=chamber,
            raw_text=raw_text,
        ))

    return events


# ---------------------------------------------------------------------------
# Action table lookup
# ---------------------------------------------------------------------------

def _find_action_table(soup: BeautifulSoup) -> Tag | None:
    """
    Find the bill history table by its distinctive 'Jrn Date' header.
    The page contains multiple table.table elements (Full Text, Fiscal Notes,
    Amendments, Minutes, Documents) so we can't rely on position or class alone.
    """
    for th in soup.find_all("th"):
        if "Jrn Date" in th.get_text():
            return th.find_parent("table")
    return None


# ---------------------------------------------------------------------------
# Bill-level metadata parsing
# ---------------------------------------------------------------------------

def _parse_information_holder(soup: BeautifulSoup) -> dict:
    """
    Parse the .information-holder block, e.g.:

        <ul class="information">
            <li><span>Current Status </span><strong>(S) RLS</strong></li>
            <li><span>Short Title </span><strong>SEXUAL ASSAULT...</strong></li>
        </ul>

    Returns a dict keyed by normalised label text.
    """
    data: dict = {}
    for li in soup.select(".information-holder ul.information li"):
        label_el = li.find("span")
        value_el = li.find("strong")
        if label_el and value_el:
            label = label_el.get_text(strip=True).rstrip(":").strip()
            value = value_el.get_text(strip=True)
            if value:
                data[label] = value
    return data


def _parse_bill_meta(soup: BeautifulSoup) -> dict:
    info = _parse_information_holder(soup)

    meta: dict = {
        "status": info.get("Current Status"),
        "short_title": info.get("Short Title"),
    }

    # Full title lives in the page heading or a dedicated element
    for sel in ("h1.bill-title", ".bill-title", "#bill-title", "h1"):
        el = soup.select_one(sel)
        if el:
            meta["title"] = el.get_text(separator=" ", strip=True)
            break

    return meta


def _parse_keywords(soup: BeautifulSoup) -> list[ScrapedKeyword]:
    """Parse the official subject keywords from ul.list-links.

    The first <li> contains "Similar Subject Match" / "Exact Subject Match"
    navigation links — those are skipped.  All subsequent <li> elements each
    contain one keyword link.
    """
    keywords: list[ScrapedKeyword] = []
    ul = soup.select_one("ul.list-links")
    if not ul:
        return keywords
    skip = {"Similar Subject Match", "Exact Subject Match"}
    for li in ul.find_all("li"):
        for link in li.find_all("a"):
            text = link.get_text(strip=True)
            if text in skip:
                continue
            href = link.get("href")
            url = _absolute_url(href) if href else None
            keywords.append(ScrapedKeyword(keyword=text, url=url))
    return keywords


def _parse_sponsors(soup: BeautifulSoup) -> list[ScrapedSponsor]:
    """Parse sponsors from the .information-holder block.

    The page has one <li> whose <span> starts with "Sponsor" and whose
    <strong> contains a comma-separated list of names, e.g.:
        REPRESENTATIVES COULOMBE, Tomaszewski, Vance, ...
    or a single senator:
        SENATOR STEVENS
    """
    sponsors: list[ScrapedSponsor] = []
    for li in soup.select(".information-holder ul.information li"):
        span = li.find("span")
        strong = li.find("strong")
        if not span or not strong:
            continue
        if not span.get_text(strip=True).upper().startswith("SPONSOR"):
            continue
        raw = strong.get_text(separator=" ", strip=True)
        # Strip leading "REPRESENTATIVES" / "SENATORS" / "REPRESENTATIVE" / "SENATOR"
        raw = re.sub(r"^(REPRESENTATIVES?|SENATORS?)\s+", "", raw, flags=re.IGNORECASE)
        names = [n.strip() for n in raw.split(",") if n.strip()]
        for i, name in enumerate(names):
            sponsors.append(ScrapedSponsor(
                name=name,
                sponsor_type="primary" if i == 0 else "cosponsor",
            ))
        break
    return sponsors


# ---------------------------------------------------------------------------
# Full page parser
# ---------------------------------------------------------------------------

def parse_bill_page(
    html: str, bill_number: str, session: int, source_url: str
) -> ScrapedBill:
    soup = BeautifulSoup(html, "html.parser")
    meta = _parse_bill_meta(soup)

    bill = ScrapedBill(
        bill_number=bill_number,
        session=session,
        source_url=source_url,
        title=meta.get("title"),
        short_title=meta.get("short_title"),
        status=meta.get("status"),
    )

    bill.sponsors = _parse_sponsors(soup)
    bill.keywords = _parse_keywords(soup)

    # Find the action table by its distinctive "Jrn Date" header — the page
    # contains several table.table elements (Full Text, Fiscal Notes, etc.)
    # and select_one("table.table") would grab the wrong one.
    action_table = _find_action_table(soup)
    if action_table:
        raw_rows = _parse_action_table(action_table)
        bill.events = _group_into_events(raw_rows)

        # Derive introduced_date from the earliest READ THE FIRST TIME event
        for event in sorted(bill.events, key=lambda e: e.event_date):
            if "READ THE FIRST TIME" in event.raw_text.upper():
                bill.introduced_date = event.event_date
                break

    return bill


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

async def scrape_bill_list(session: int) -> list[str]:
    """
    Fetch the Range page and return every bill number listed for the session.
    The listing page is static HTML — no Playwright needed.
    Returns normalised bill numbers like ["HB 1", "HB 2", ..., "SB 1", ...].
    """
    import httpx

    url = BASE_URL + BILL_RANGE_PATH.format(session=session)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    bill_numbers: list[str] = []
    for td in soup.find_all("td", class_="billRoot"):
        link = td.find("a")
        if link:
            # Handles "HB   1" (extra spaces) and "SB1003" (no space).
            m = _BILL_ROOT_RE.match(link.get_text(strip=True))
            if m:
                bill_numbers.append(f"{m.group(1).upper()} {m.group(2)}")
    return bill_numbers


async def scrape_bill(bill_number: str, session: int) -> ScrapedBill:
    """Fetch and parse a single bill from akleg.gov."""
    url = build_bill_url(bill_number, session)
    html = await fetch_bill_html(url)
    return parse_bill_page(html, bill_number, session, url)
