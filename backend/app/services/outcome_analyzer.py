"""
Fetches the source document for a BillEvent and uses Mistral AI to extract
structured legislative outcomes.

For each event we:
  1. Fetch the source URL (Journal page or Committee Meeting detail)
  2. Strip HTML to clean text and truncate to keep token cost bounded
  3. Send to mistral-small-latest with a tool definition that mirrors
     BillEventOutcome — forcing a structured JSON response
  4. Parse each tool call into a ScrapedOutcome dataclass
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

import httpx
from bs4 import BeautifulSoup
from mistralai import Mistral

from app.config import settings
from app.models.bill import Chamber, OutcomeType
from app.services.bill_scraper import ScrapedEvent

MISTRAL_MODEL = "mistral-small-latest"

# Roughly 3 000 tokens of input per page — well within small-model limits
_MAX_TEXT_CHARS = 12_000

_RETRY_ATTEMPTS = 4
_RETRY_BASE_DELAY = 2.0   # seconds; doubles each attempt (2, 4, 8, 16)

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; AKLegLiaisonBot/1.0)"
}


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------

@dataclass
class ScrapedOutcome:
    chamber: Chamber
    outcome_type: OutcomeType
    description: str
    committee: str | None = None


# ---------------------------------------------------------------------------
# Mistral tool definition  (mirrors BillEventOutcome fields)
# ---------------------------------------------------------------------------

_OUTCOME_TOOL = {
    "type": "function",
    "function": {
        "name": "record_outcome",
        "description": (
            "Record one legislative outcome for the specific bill in this event. "
            "Call once per distinct outcome found in the document."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "chamber": {
                    "type": "string",
                    "enum": ["House", "Senate"],
                    "description": "Which chamber this outcome occurred in.",
                },
                "outcome_type": {
                    "type": "string",
                    "enum": [t.value for t in OutcomeType],
                    "description": "The specific type of legislative outcome.",
                },
                "description": {
                    "type": "string",
                    "description": "One concise sentence describing what happened.",
                },
                "committee": {
                    "type": "string",
                    "description": (
                        "Full committee name if this is a committee-level outcome "
                        "(e.g. 'House Judiciary'). Omit for floor actions."
                    ),
                },
            },
            "required": ["chamber", "outcome_type", "description"],
        },
    },
}

_SYSTEM_PROMPT = """\
You are an expert on Alaska state legislative procedure.

Given text from an Alaska Legislature journal page or committee meeting summary,
identify all concrete outcomes for the specific bill noted in the event context.
Focus only on actions that were actually taken — not scheduled hearings, \
administrative notes, or fiscal note references.

IMPORTANT: Limit your reported outcomes to what is directly reflected in the \
"Raw action text" provided with the event. The journal page may contain many \
other entries for the same bill on the same day; do not report outcomes for \
those other entries — they are tracked as separate events with their own \
source links. For example, if the raw action text says "(H) RULES TO CALENDAR \
| (H) MOVED TO BOTTOM OF CALENDAR", report only rules_to_calendar — do not \
also report amended outcomes visible elsewhere on the journal page.

Call record_outcome once for each distinct outcome. If the document contains no \
clear outcome for this bill, call once with outcome_type "other" and a brief \
explanation in the description field.

Enum guidance:
- Use "read_on_floor" for ALL floor readings regardless of number \
(first, second, or third reading). Do not use "read_first_time", \
"read_second_time", or "read_third_time" — those are not valid values.
- Use "other" for any action that does not clearly match another enum value \
(e.g. advanced to third reading, engrossment, effective date notes, a motion \
to table an amendment, or a bill dying in committee).
- For "referred_to_committee", the committee field is REQUIRED — never omit \
it. It must be the DESTINATION committee named in the referral sentence — \
never the committee that wrote the report. The reporting committee and the \
destination committee are always different. Concrete examples:
  * "The Judiciary Committee considered... HB 62 was referred to the Finance \
Committee." → committee = "House Finance" (NOT "House Judiciary")
  * "The Finance Committee considered... referred to the Rules Committee." \
→ committee = "House Rules" (NOT "House Finance")
  * "The Labor & Commerce Committee considered... HB 25 was referred to the \
Rules Committee." → committee = "House Rules" (NOT "House Labor & Commerce")
  Look for the sentence beginning "HB [number] was referred to" or \
"The bill was referred to" — it is often the LAST sentence of the entry — \
and use the committee named in THAT sentence.
- Always format the committee field as "[Chamber] [Committee Name]" in title \
case, where Chamber is either "House" or "Senate". Determine the chamber \
from the journal header at the top of the document — it will say either \
"House Journal" or "Senate Journal". \
Examples: "House Judiciary", "Senate Finance", "House Rules". \
Never omit the chamber prefix and never use all caps.\
"""


# ---------------------------------------------------------------------------
# Journal page filtering
# ---------------------------------------------------------------------------

# Matches headers like "2026-02-25     House Journal     Page 1722"
_JOURNAL_PAGE_HEADER_RE = re.compile(
    r"^\S+\s+(?:House|Senate) Journal\s+Page\s+(\d+)\s*$",
    re.MULTILINE | re.IGNORECASE,
)


def _target_journal_page(url: str) -> int | None:
    """Return the integer page number from a Journal URL's Page= parameter."""
    qs = parse_qs(urlparse(url).query)
    vals = qs.get("Page", [])
    if not vals:
        return None
    try:
        return int(vals[0])
    except ValueError:
        return None


def _slice_journal_page(text: str, target_page: int) -> str:
    """
    Return only the text belonging to *target_page* from a multi-page
    journal document.  Falls back to the full text if the page isn't found.
    """
    boundaries = [
        (m.start(), int(m.group(1)))
        for m in _JOURNAL_PAGE_HEADER_RE.finditer(text)
    ]
    for i, (start, page_num) in enumerate(boundaries):
        if page_num == target_page:
            end = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(text)
            return text[start:end]
    return text


# ---------------------------------------------------------------------------
# Page fetch + text extraction
# ---------------------------------------------------------------------------

async def _fetch_page_text(url: str) -> str:
    """
    Fetch *url* with httpx and return stripped plain text, capped at
    _MAX_TEXT_CHARS.  Navigational chrome (header/footer/nav/breadcrumbs)
    is removed first so the model sees mostly content.

    For Alaska House/Senate Journal URLs (which return a multi-page document),
    the text is filtered down to the single journal page indicated by the
    URL's Page= query parameter before truncation.
    """
    async with httpx.AsyncClient(
        follow_redirects=True, timeout=30, headers=_HEADERS
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup.select("header, footer, nav, script, style, .breadcrumbs"):
        tag.decompose()

    text = soup.get_text(separator="\n", strip=True)
    lines = [ln for ln in text.splitlines() if ln.strip()]
    text = "\n".join(lines)

    target_page = _target_journal_page(url)
    if target_page is not None and "Journal/Pages" in url:
        text = _slice_journal_page(text, target_page)

    return text[:_MAX_TEXT_CHARS]


# ---------------------------------------------------------------------------
# Mistral call (wrapped in asyncio.to_thread — SDK is synchronous)
# ---------------------------------------------------------------------------

def _call_mistral(user_message: str) -> list[ScrapedOutcome]:
    client = Mistral(api_key=settings.mistral_api_key)
    response = client.chat.complete(
        model=MISTRAL_MODEL,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user",   "content": user_message},
        ],
        tools=[_OUTCOME_TOOL],
        tool_choice="any",
        temperature=0,
    )

    outcomes: list[ScrapedOutcome] = []
    for tool_call in (response.choices[0].message.tool_calls or []):
        try:
            data = json.loads(tool_call.function.arguments)
            try:
                outcome_type = OutcomeType(data["outcome_type"])
            except ValueError:
                print(f"  [warn] Unknown outcome_type {data['outcome_type']!r} — storing as OTHER")
                outcome_type = OutcomeType.OTHER
            outcomes.append(ScrapedOutcome(
                chamber=Chamber(data["chamber"]),
                outcome_type=outcome_type,
                description=data["description"],
                committee=data.get("committee"),
            ))
        except (KeyError, ValueError) as exc:
            print(f"  [warn] Could not parse tool response: {exc}")
            print(f"         Raw arguments: {tool_call.function.arguments}")

    return outcomes


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def analyze_event(event: ScrapedEvent, bill_number: str) -> list[ScrapedOutcome]:
    """
    Fetch the source document for *event* and ask Mistral to classify outcomes.

    Returns a (possibly empty) list of ScrapedOutcome objects.
    Raises httpx.HTTPError if the source page cannot be fetched.
    Retries up to _RETRY_ATTEMPTS times on 503 errors with exponential backoff.
    """
    page_text = await _fetch_page_text(event.source_url)

    user_message = (
        f"Bill: {bill_number}\n"
        f"Event date: {event.event_date}\n"
        f"Event type: {event.event_type.value}\n"
        f"Raw action text scraped from bill history table: {event.raw_text}\n\n"
        f"--- Source document ---\n{page_text}"
    )

    last_exc: Exception | None = None
    for attempt in range(_RETRY_ATTEMPTS):
        try:
            return await asyncio.to_thread(_call_mistral, user_message)
        except Exception as exc:
            is_503 = "503" in str(exc) or "Service Unavailable" in str(exc)
            if not is_503 or attempt == _RETRY_ATTEMPTS - 1:
                raise
            delay = _RETRY_BASE_DELAY * (2 ** attempt)
            logger.warning(
                "Mistral 503 on attempt %d/%d for event %s — retrying in %.0fs",
                attempt + 1, _RETRY_ATTEMPTS, event.source_url, delay,
            )
            last_exc = exc
            await asyncio.sleep(delay)

    raise last_exc  # unreachable, satisfies type checker
