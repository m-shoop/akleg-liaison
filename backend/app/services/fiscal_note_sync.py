"""
Syncs fiscal notes from legfin.akleg.gov.

Two entry points:

  load_allnotes_entries()
      Load allNotes.php once via Playwright and return all bill entries
      (bill_url_id, bill_version, committee).  Call once per sync cycle
      and pass the result to sync_fiscal_notes_for_bill() for each bill.

  sync_fiscal_notes_for_bill(db, bill_id, bill_number, allnotes_entries, client)
      Sync all fiscal notes for a single bill using pre-loaded entries.
      Per-note algorithm:
        - fn_department, fn_appropriation, fn_allocation are parsed directly
          from the allNotesBill.php HTML and updated on every sync.
        - fn_identifier, control_code, publish_date come from the PDF and are
          only fetched when the note is new or still missing its identifier.
      Marks notes that no longer appear in this run as is_active=False.
      Logs a system audit entry for the bill.
"""

import asyncio
import io
import logging
import random
import re
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup, NavigableString
from playwright.async_api import async_playwright
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.audit_log_repository import log_system_action
from app.repositories.fiscal_note_repository import (
    deactivate_missing_notes,
    delete_fiscal_note_query_failed,
    get_note_by_session_id,
    update_note_html_fields,
    upsert_fiscal_note_query_failed,
    upsert_note_by_identifier,
)

logger = logging.getLogger(__name__)

_BASE_URL = "https://www.legfin.akleg.gov/FiscalNotes/"
_ALL_NOTES_URL = f"{_BASE_URL}allNotes.php"
_LEGISLATURE_SESSION = 34


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _url_id_to_bill_number(url_id: str) -> str:
    """Convert URL-format bill ID "HB____1" to DB format "HB 1"."""
    return " ".join(url_id.replace("_", " ").split())


def _bill_number_to_url_id(bill_number: str) -> str:
    """Convert DB format "HB 1" to URL format "HB____1" (number right-justified in 5 chars)."""
    prefix, number = bill_number.split()
    return prefix + number.rjust(5, "_")


def _parse_select_bill_calls(html: str) -> list[dict]:
    """
    Extract all selectBill() onclick parameters from the allNotes.php HTML.

    Returns a list of dicts with keys: bill_url_id, bill_version, committee.
    """
    soup = BeautifulSoup(html, "html.parser")
    entries = []
    pattern = re.compile(r"selectBill\('([^']+)','([^']+)','([^']*)','([^']*)','([^']*)'\)")
    for a_tag in soup.find_all("a", onclick=pattern):
        match = pattern.search(a_tag["onclick"])
        if match:
            entries.append({
                "bill_url_id": match.group(1),
                "bill_version": match.group(2),
                "committee": match.group(3),
            })
    return entries


def _parse_fiscal_note_links(html: str) -> list[dict]:
    """
    Parse the HTML fragment returned by allNotesBill.php.

    Returns a list of dicts with keys:
      url, session_id, fn_department, fn_appropriation, fn_allocation.

    Department, appropriation, and allocation are read from the HTML structure
    by walking backwards from each fiscalNote.php link:
      - <b> tag                          → department
      - text with 4 leading &nbsp; chars → appropriation
      - text with 8 leading &nbsp; chars → allocation
    """
    soup = BeautifulSoup(html, "html.parser")
    notes = []
    for a_tag in soup.find_all("a", href=re.compile(r"fiscalNote\.php")):
        href = a_tag["href"]
        full_url = urljoin(_BASE_URL, href)
        params = parse_qs(urlparse(href).query)
        sid = params.get("sid", [None])[0]
        if not sid:
            continue

        fn_department = None
        fn_appropriation = None
        fn_allocation = None

        for sibling in a_tag.previous_siblings:
            if fn_department and fn_appropriation and fn_allocation:
                break
            if getattr(sibling, "name", None) == "b":
                if fn_department is None:
                    fn_department = sibling.get_text(strip=True)
            elif isinstance(sibling, NavigableString):
                leading = len(sibling) - len(sibling.lstrip("\xa0"))
                text = sibling.strip("\xa0").strip()
                if not text:
                    continue
                if leading >= 8 and fn_allocation is None:
                    fn_allocation = text
                elif leading >= 4 and fn_appropriation is None:
                    fn_appropriation = text

        notes.append({
            "url": full_url,
            "session_id": sid,
            "fn_department": fn_department,
            "fn_appropriation": fn_appropriation,
            "fn_allocation": fn_allocation,
        })
    return notes


def _parse_text_fields(text: str) -> dict:
    """
    Extract fn_identifier, control_code, and publish_date from the plain text
    of a fiscal note PDF.  fn_department is now sourced from the HTML listing
    and is no longer parsed here.
    """
    id_match = re.search(r"Identifier:\s+(\S+)", text)
    fn_identifier = id_match.group(1).strip() if id_match else None

    # Control Code appears on each page — take the last occurrence
    code_matches = re.findall(r"Control Code:\s+(\S+)", text)
    control_code = code_matches[-1] if code_matches else None

    publish_date = None
    date_match = re.search(r"Publish Date:\s+(\d{1,2}/\d{1,2}/\d{4})", text)
    if date_match:
        from datetime import datetime
        publish_date = datetime.strptime(date_match.group(1), "%m/%d/%Y").date()

    return {
        "fn_identifier": fn_identifier,
        "control_code": control_code,
        "publish_date": publish_date,
    }


def _parse_pdf_fields(pdf_bytes: bytes) -> dict:
    """
    Synchronous helper — run in a thread pool via asyncio.to_thread().
    Extracts fn_identifier, control_code, and publish_date from a fiscal note PDF.
    """
    import pdfplumber

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)

    return _parse_text_fields(full_text)


# ---------------------------------------------------------------------------
# Core sync logic
# ---------------------------------------------------------------------------

async def _fetch_bill_note_links(
    client: httpx.AsyncClient,
    bill_url_id: str,
    bill_version: str,
    committee: str,
) -> list[dict]:
    """Call allNotesBill.php and return parsed fiscal note link dicts."""
    sid = random.random()
    params = {
        "q": "",
        "billID": bill_url_id,
        "billVersion": bill_version,
        "committee": committee,
        "userID": "",
        "session": str(_LEGISLATURE_SESSION),
        "sid": str(sid),
    }
    try:
        resp = await client.get(f"{_BASE_URL}allNotesBill.php", params=params, timeout=30)
        resp.raise_for_status()
        return _parse_fiscal_note_links(resp.text)
    except Exception as exc:
        logger.warning("[fiscal_note_sync] Failed to fetch notes for %s: %s", bill_url_id, exc)
        return []


async def _fetch_pdf(client: httpx.AsyncClient, url: str) -> bytes | None:
    """
    Fetch a fiscal note PDF and return raw bytes, or None on failure.

    Validates that the response is actually a PDF before returning — the PHP
    server occasionally returns an HTML error page with a 200 status, which
    would cause pdfplumber to raise when it tries to parse it.
    """
    try:
        resp = await client.get(url, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        if not resp.content.startswith(b"%PDF"):
            logger.warning(
                "[fiscal_note_sync] Non-PDF response for %s (content-type: %s)",
                url,
                resp.headers.get("content-type", "unknown"),
            )
            return None
        return resp.content
    except Exception as exc:
        logger.warning("[fiscal_note_sync] Failed to fetch PDF %s: %s", url, exc)
        return None


async def _sync_bill_fiscal_notes(
    db: AsyncSession,
    client: httpx.AsyncClient,
    bill_id: int,
    bill_number: str,
    bill_url_id: str,
    bill_version: str,
    committee: str,
) -> tuple[int, bool]:
    """
    Sync all fiscal notes for a single bill version/committee entry.
    Returns (new_notes_inserted, had_failure).

    had_failure is True if any note in the listing could not be fully retrieved
    (PDF fetch failed, parse error, or no identifier found in the PDF).

    Per-note algorithm:
      1. Cheap path: if this session_id is already in the DB and fn_identifier is
         known, just refresh the HTML-derived fields — no PDF fetch needed.
      2. Otherwise fetch the PDF to obtain fn_identifier, then upsert keyed on
         (bill_id, fn_identifier). This handles both truly new notes and notes
         whose session_id changed since the last sync.
    """
    note_links = await _fetch_bill_note_links(client, bill_url_id, bill_version, committee)
    if not note_links:
        return 0, False

    active_fn_identifiers: list[str] = []
    new_count = 0
    had_failure = False

    for note in note_links:
        # Cheap path: session_id unchanged and identifier already parsed.
        existing = await get_note_by_session_id(db, bill_id, note["session_id"])
        if existing and existing.fn_identifier:
            await update_note_html_fields(
                db,
                existing.id,
                note["url"],
                note.get("fn_department"),
                note.get("fn_appropriation"),
                note.get("fn_allocation"),
            )
            active_fn_identifiers.append(existing.fn_identifier)
            continue

        # Session_id not recognized, or existing row still missing fn_identifier:
        # fetch the PDF to obtain a stable identifier.
        await asyncio.sleep(1.5)
        pdf_bytes = await _fetch_pdf(client, note["url"])
        if not pdf_bytes:
            logger.warning("[fiscal_note_sync] Could not fetch PDF for %s, skipping.", note["url"])
            had_failure = True
            continue

        try:
            pdf_fields = await asyncio.to_thread(_parse_pdf_fields, pdf_bytes)
        except Exception as exc:
            logger.warning("[fiscal_note_sync] Failed to parse PDF %s: %s", note["url"], exc)
            had_failure = True
            continue

        fn_identifier = pdf_fields.get("fn_identifier")
        if not fn_identifier:
            logger.warning(
                "[fiscal_note_sync] No fn_identifier parsed from %s, skipping.", note["url"]
            )
            had_failure = True
            continue

        _, is_new = await upsert_note_by_identifier(
            db,
            bill_id=bill_id,
            fn_identifier=fn_identifier,
            session_id=note["session_id"],
            url=note["url"],
            fn_department=note.get("fn_department"),
            fn_appropriation=note.get("fn_appropriation"),
            fn_allocation=note.get("fn_allocation"),
            control_code=pdf_fields.get("control_code"),
            publish_date=pdf_fields.get("publish_date"),
        )
        active_fn_identifiers.append(fn_identifier)
        if is_new:
            new_count += 1

    await deactivate_missing_notes(db, bill_id, active_fn_identifiers)

    await log_system_action(
        db,
        action="fiscal_notes_synced",
        entity_type="bill",
        entity_id=bill_id,
        details={
            "bill_number": bill_number,
            "notes_found": len(note_links),
            "new_notes": new_count,
            "had_failure": had_failure,
        },
    )

    return new_count, had_failure


async def _fetch_all_notes_html() -> str | None:
    """Use Playwright to load allNotes.php and return the page HTML."""
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(_ALL_NOTES_URL, timeout=60_000)
            # Wait for the bill table to be present
            await page.wait_for_selector("a[onclick*='selectBill']", timeout=30_000)
            html = await page.content()
            await browser.close()
            return html
    except Exception as exc:
        logger.warning("[fiscal_note_sync] Playwright error loading allNotes.php: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def load_allnotes_entries() -> list[dict] | None:
    """
    Load allNotes.php via Playwright and return all parsed bill entries.

    Each entry is a dict with keys: bill_url_id, bill_version, committee.
    Returns None if the page could not be loaded.  Call once per sync cycle
    and pass the result to sync_fiscal_notes_for_bill() for each bill.
    """
    html = await _fetch_all_notes_html()
    if not html:
        logger.warning("[fiscal_note_sync] Could not load allNotes.php.")
        return None
    entries = _parse_select_bill_calls(html)
    logger.info("[fiscal_note_sync] allNotes.php: %d bill entries found.", len(entries))
    return entries


async def sync_fiscal_notes_for_bill(
    db: AsyncSession,
    bill_id: int,
    bill_number: str,
    allnotes_entries: list[dict],
    client: httpx.AsyncClient,
) -> int:
    """
    Sync all fiscal notes for a single bill using pre-loaded allNotes entries.

    Filters allnotes_entries to entries matching bill_number, then calls
    allNotesBill.php for each matching version/committee combination.
    Returns the total number of new notes inserted across all entries.
    """
    bill_url_id = _bill_number_to_url_id(bill_number)
    bill_entries = [e for e in allnotes_entries if e["bill_url_id"] == bill_url_id]
    if not bill_entries:
        return 0

    new_total = 0
    any_failure = False
    for entry in bill_entries:
        new_count, had_failure = await _sync_bill_fiscal_notes(
            db,
            client,
            bill_id,
            bill_number,
            entry["bill_url_id"],
            entry["bill_version"],
            entry["committee"],
        )
        new_total += new_count
        if had_failure:
            any_failure = True

    if any_failure:
        await upsert_fiscal_note_query_failed(db, bill_id)
    else:
        await delete_fiscal_note_query_failed(db, bill_id)

    return new_total
