"""
Syncs fiscal notes from legfin.akleg.gov for all bills in the local database.

Algorithm per run:
  1. Load https://www.legfin.akleg.gov/FiscalNotes/allNotes.php with Playwright
     to get the list of all bills that have fiscal notes, along with their
     billVersion and committee params for the API call.
  2. For each bill entry found, look up the bill in our database.
  3. If found, call allNotesBill.php (the reverse-engineered PHP endpoint) to
     get the list of fiscal notes for that bill.
  4. Parse the response HTML for fiscalNote.php links.
  5. For each link, upsert into fiscal_notes:
     - New notes: fetch the PDF, parse fn_department / fn_identifier / control_code.
     - Existing notes: update is_active=True and last_synced only.
  6. Mark any previously-known notes that did NOT appear this run as is_active=False.
  7. Log a system audit entry per bill processed.
"""

import asyncio
import io
import logging
import random
import re
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bill import Bill
from app.repositories.audit_log_repository import log_system_action
from app.repositories.fiscal_note_repository import deactivate_missing_notes, upsert_fiscal_note

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

    Returns a list of dicts with keys: url (full), session_id (sid param).
    """
    soup = BeautifulSoup(html, "html.parser")
    notes = []
    for a_tag in soup.find_all("a", href=re.compile(r"fiscalNote\.php")):
        href = a_tag["href"]
        full_url = urljoin(_BASE_URL, href)
        params = parse_qs(urlparse(href).query)
        sid = params.get("sid", [None])[0]
        if sid:
            notes.append({"url": full_url, "session_id": sid})
    return notes


def _parse_text_fields(text: str) -> dict:
    """
    Extract fn_department, fn_identifier, control_code, and publish_date
    from the plain text of a fiscal note PDF.
    """
    dept_match = re.search(r"Department:\s+(.+)", text)
    fn_department = dept_match.group(1).strip() if dept_match else None

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
        "fn_department": fn_department,
        "fn_identifier": fn_identifier,
        "control_code": control_code,
        "publish_date": publish_date,
    }


def _parse_pdf_fields(pdf_bytes: bytes) -> dict:
    """
    Synchronous helper — run in a thread pool via asyncio.to_thread().
    Extracts fn_department, fn_identifier, control_code, publish_date from a fiscal note PDF.
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
    """Fetch a fiscal note PDF and return raw bytes, or None on failure."""
    try:
        resp = await client.get(url, timeout=60, follow_redirects=True)
        resp.raise_for_status()
        return resp.content
    except Exception as exc:
        logger.warning("[fiscal_note_sync] Failed to fetch PDF %s: %s", url, exc)
        return None


async def _sync_bill_fiscal_notes(
    db: AsyncSession,
    client: httpx.AsyncClient,
    bill: Bill,
    bill_url_id: str,
    bill_version: str,
    committee: str,
) -> int:
    """
    Sync all fiscal notes for a single bill.
    Returns the number of new notes inserted.
    """
    note_links = await _fetch_bill_note_links(client, bill_url_id, bill_version, committee)
    if not note_links:
        return 0

    active_session_ids = [n["session_id"] for n in note_links]
    new_count = 0

    for note in note_links:
        pdf_fields: dict = {}
        fiscal_note_id, is_new = await upsert_fiscal_note(
            db,
            bill_id=bill.id,
            session_id=note["session_id"],
            url=note["url"],
        )

        if is_new:
            pdf_bytes = await _fetch_pdf(client, note["url"])
            if pdf_bytes:
                pdf_fields = await asyncio.to_thread(_parse_pdf_fields, pdf_bytes)
                # Update the row with the parsed PDF data
                from app.models.fiscal_note import FiscalNote
                from sqlalchemy import update
                await db.execute(
                    update(FiscalNote)
                    .where(FiscalNote.id == fiscal_note_id)
                    .values(**pdf_fields)
                )
            new_count += 1

    await deactivate_missing_notes(db, bill.id, active_session_ids)

    await log_system_action(
        db,
        action="fiscal_notes_synced",
        entity_type="bill",
        entity_id=bill.id,
        details={
            "bill_number": bill.bill_number,
            "notes_found": len(note_links),
            "new_notes": new_count,
        },
    )

    return new_count


async def sync_all_fiscal_notes(db: AsyncSession) -> None:
    """
    Entry point for the scheduled fiscal note sync.
    Loads allNotes.php via Playwright, then fetches notes for each known bill.
    """
    logger.info("[fiscal_note_sync] Starting fiscal note sync.")

    # Step 1: load allNotes.php to get all bill entries
    html = await _fetch_all_notes_html()
    if not html:
        logger.warning("[fiscal_note_sync] Could not load allNotes.php — aborting.")
        return

    entries = _parse_select_bill_calls(html)
    logger.info("[fiscal_note_sync] Found %d bill entries on allNotes.php.", len(entries))

    # Step 2: sync each entry that has a matching bill in our DB
    async with httpx.AsyncClient() as client:
        for entry in entries:
            bill_number = _url_id_to_bill_number(entry["bill_url_id"])
            result = await db.execute(
                select(Bill).where(
                    Bill.bill_number == bill_number,
                    Bill.session == _LEGISLATURE_SESSION,
                )
            )
            bill = result.scalar_one_or_none()
            if bill is None:
                continue

            try:
                new_count = await _sync_bill_fiscal_notes(
                    db,
                    client,
                    bill,
                    entry["bill_url_id"],
                    entry["bill_version"],
                    entry["committee"],
                )
                await db.commit()
                if new_count:
                    logger.info(
                        "[fiscal_note_sync] %s: %d new note(s).", bill_number, new_count
                    )
            except Exception as exc:
                await db.rollback()
                logger.warning(
                    "[fiscal_note_sync] Error syncing %s: %s", bill_number, exc
                )

    logger.info("[fiscal_note_sync] Fiscal note sync complete.")


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
