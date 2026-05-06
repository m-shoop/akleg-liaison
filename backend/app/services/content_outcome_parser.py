"""
Regex-based outcome parser for BillEvent.raw_text.

Some committees (especially smaller ones) publish only audio/video for their
hearings — no textual minutes — so the Mistral analyzer that fetches the
source document can't recover any outcomes. The action-text scraped from the
bill detail page (stored in BillEvent.raw_text) often *does* contain a short
phrase like "Heard & Held" or "Moved HB 384 Out of Committee". This module
extracts those phrases via regex so we don't lose the outcome.

For committee-action events, the committee is recovered from the source URL
(e.g. "...Meeting=HJUD ..." → "House Judiciary"). Floor-session events don't
have a committee in the URL — Mistral handles their committee inference from
the journal page text — so the URL is not consulted for those.

Outcomes from this module are persisted with ai_generated=False, and the
display layer's deduplicator prefers ai_generated=True rows when both are
present (the AI-generated description is richer).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, unquote, urlparse

from app.models.bill import Chamber, OutcomeType


@dataclass
class ContentParsedOutcome:
    """Result of regex-matching against BillEvent.raw_text.

    Mirrors outcome_analyzer.ScrapedOutcome but lives here to avoid a
    backwards dependency on the Mistral module.
    """
    chamber: Chamber
    outcome_type: OutcomeType
    description: str
    committee: str | None = None


# ---------------------------------------------------------------------------
# Committee-code map (URL Meeting= prefix → committee_name in title case)
#
# Codes are taken verbatim from akleg.gov Meeting URLs. Names match the
# title-case format used elsewhere in the app's outcome.committee column
# (see existing AI-generated rows: "House Finance", "Senate Judiciary",
# etc.). Unknown codes resolve to None so we never fabricate a label.
# ---------------------------------------------------------------------------

_COMMITTEE_NAMES: dict[str, str] = {
    # -- House --
    "HCRA": "Community & Regional Affairs",
    "HEDC": "Education",
    "HENE": "Energy",
    "HFIN": "Finance",
    "HFSH": "Fisheries",
    "HHSS": "Health & Social Services",
    "HJUD": "Judiciary",
    "HL&C": "Labor & Commerce",
    "HMLV": "Military & Veterans' Affairs",
    "HRES": "Resources",
    "HRLS": "Rules",
    "HSTA": "State Affairs",
    "HTRA": "Transportation",
    "HTRB": "Tribal Affairs",
    # -- Senate --
    "SCRA": "Community & Regional Affairs",
    "SEDC": "Education",
    "SFIN": "Finance",
    "SHSS": "Health & Social Services",
    "SJUD": "Judiciary",
    "SL&C": "Labor & Commerce",
    "SMLV": "Military & Veterans' Affairs",
    "SRES": "Resources",
    "SRLS": "Rules",
    "SSTA": "State Affairs",
    "STRA": "Transportation",
}

# Each entry: (compiled pattern, outcome_type, default description, fallback committee suffix).
# `fallback_committee_suffix` is appended to the chamber name when the URL
# can't supply a more specific committee (e.g. "Rules" -> "House Rules").
# None means leave the committee field empty when no URL match is found.
_PATTERNS: tuple[tuple[re.Pattern[str], OutcomeType, str, str | None], ...] = (
    (
        re.compile(r"\bHeard\s*&\s*Held\b", re.IGNORECASE),
        OutcomeType.HEARD_AND_HELD,
        "Heard & Held",
        None,
    ),
    (
        # "Moved HB 384 Out of Committee", "Moved SB 12 Out of Committee", etc.
        # The bill identifier between "Moved" and "Out of Committee" is optional
        # so phrasings without it still match.
        re.compile(r"\bMoved\b[^|]{0,40}\bOut\s+of\s+Committee\b", re.IGNORECASE),
        OutcomeType.MOVED_OUT_OF_COMMITTEE,
        "Moved Out of Committee",
        None,
    ),
    (
        re.compile(r"\bReferred\s+to\s+Rules\b", re.IGNORECASE),
        OutcomeType.REFERRED_TO_COMMITTEE,
        "Referred to Rules",
        "Rules",
    ),
)


def _committee_from_url(source_url: str | None, chamber: Chamber) -> str | None:
    """
    Extract the committee name from a BillEvent.source_url.

    Returns None for floor-action URLs (Journal pages) and for any URL that
    doesn't carry a recognizable Meeting= committee prefix. Unknown
    committee codes return None rather than fabricating a label.
    """
    if not source_url or "Meeting/Detail" not in source_url:
        return None

    qs = parse_qs(urlparse(source_url).query)
    meeting_vals = qs.get("Meeting") or []
    if not meeting_vals:
        return None

    # Format: "<CODE> 2025-02-05 13:00:00" — code is everything before the first space.
    # parse_qs already URL-decodes, so HL%26C → "HL&C".
    raw = unquote(meeting_vals[0]).strip()
    code = raw.split(" ", 1)[0].upper()
    if not code:
        return None

    name = _COMMITTEE_NAMES.get(code)
    if name is None:
        return None
    return f"{chamber.value} {name}"


def parse_outcomes_from_raw_text(
    raw_text: str,
    chamber: Chamber,
    source_url: str | None = None,
) -> list[ContentParsedOutcome]:
    """
    Apply the regex patterns to *raw_text* and return one outcome per
    distinct match.

    A given outcome_type is reported at most once per call — duplicate
    phrases inside the same event's raw_text collapse into one outcome.

    `source_url` is consulted for committee-action URLs only (Meeting=...);
    for floor-session URLs (Journal pages) it is ignored, matching the
    user's requirement that floor sessions never derive a committee from
    the URL.
    """
    url_committee = _committee_from_url(source_url, chamber)

    seen: set[OutcomeType] = set()
    outcomes: list[ContentParsedOutcome] = []
    for pattern, outcome_type, description, fallback_suffix in _PATTERNS:
        if outcome_type in seen:
            continue
        if not pattern.search(raw_text):
            continue
        seen.add(outcome_type)

        if url_committee is not None:
            committee = url_committee
        elif fallback_suffix is not None:
            committee = f"{chamber.value} {fallback_suffix}"
        else:
            committee = None

        outcomes.append(ContentParsedOutcome(
            chamber=chamber,
            outcome_type=outcome_type,
            description=description,
            committee=committee,
        ))
    return outcomes
