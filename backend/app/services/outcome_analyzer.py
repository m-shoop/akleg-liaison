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
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup
from mistralai import Mistral

from app.config import settings
from app.models.bill import Chamber, OutcomeType
from app.services.bill_scraper import ScrapedEvent

# Roughly 3 000 tokens of input per page — well within small-model limits
_MAX_TEXT_CHARS = 12_000

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

Call record_outcome once for each distinct outcome. If the document contains no \
clear outcome for this bill, call once with outcome_type "other" and a brief \
explanation in the description field.

Enum guidance:
- Use "read_on_floor" for ALL floor readings regardless of number \
(first, second, or third reading). Do not use "read_first_time", \
"read_second_time", or "read_third_time" — those are not valid values.
- Use "other" for any action that does not clearly match another enum value \
(e.g. advanced to third reading, engrossment, effective date notes).
- For "referred_to_committee", the committee field must be the DESTINATION \
committee named in the referral sentence — never the committee that wrote \
the report. The reporting committee and the destination committee are always \
different. Concrete examples:
  * "The Judiciary Committee considered... HB 62 was referred to the Finance \
Committee." → committee = "House Finance" (NOT "House Judiciary")
  * "The Finance Committee considered... referred to the Rules Committee." \
→ committee = "House Rules" (NOT "House Finance")
  Look for the sentence beginning "HB [number] was referred to" or \
"The bill was referred to" and use the committee named in THAT sentence.
- Always format the committee field as "[Chamber] [Committee Name]" in title \
case, where Chamber is either "House" or "Senate". \
Examples: "House Judiciary", "Senate Finance", "House Rules". \
Never omit the chamber prefix and never use all caps.\
"""


# ---------------------------------------------------------------------------
# Page fetch + text extraction
# ---------------------------------------------------------------------------

async def _fetch_page_text(url: str) -> str:
    """
    Fetch *url* with httpx and return stripped plain text, capped at
    _MAX_TEXT_CHARS.  Navigational chrome (header/footer/nav/breadcrumbs)
    is removed first so the model sees mostly content.
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
    return text[:_MAX_TEXT_CHARS]


# ---------------------------------------------------------------------------
# Mistral call (wrapped in asyncio.to_thread — SDK is synchronous)
# ---------------------------------------------------------------------------

def _call_mistral(user_message: str) -> list[ScrapedOutcome]:
    client = Mistral(api_key=settings.mistral_api_key)
    response = client.chat.complete(
        model="mistral-small-latest",
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
    """
    page_text = await _fetch_page_text(event.source_url)

    user_message = (
        f"Bill: {bill_number}\n"
        f"Event date: {event.event_date}\n"
        f"Event type: {event.event_type.value}\n"
        f"Raw action text scraped from bill history table: {event.raw_text}\n\n"
        f"--- Source document ---\n{page_text}"
    )

    return await asyncio.to_thread(_call_mistral, user_message)
