"""Tests for the regex-based BillEvent.raw_text outcome parser."""

import pytest

from app.models.bill import Chamber, OutcomeType
from app.services.content_outcome_parser import parse_outcomes_from_raw_text


def _types(outcomes):
    return {o.outcome_type for o in outcomes}


def test_heard_and_held_committee_action_no_url():
    """Without a source URL, committee field is left empty for H&H/MoC."""
    raw = "(H) TRIBAL AFFAIRS at 08:00 AM DAVIS 106 | (H) Heard & Held"
    outcomes = parse_outcomes_from_raw_text(raw, Chamber.HOUSE)
    assert _types(outcomes) == {OutcomeType.HEARD_AND_HELD}
    [oc] = outcomes
    assert oc.chamber == Chamber.HOUSE
    assert oc.committee is None
    assert oc.description == "Heard & Held"


def test_heard_and_held_committee_resolved_from_url():
    raw = "(H) TRIBAL AFFAIRS at 08:00 AM DAVIS 106 | (H) Heard & Held"
    url = "https://www.akleg.gov/basis/Meeting/Detail/?Meeting=HTRB 2026-04-21 08:00:00&Bill=HB 384"
    [oc] = parse_outcomes_from_raw_text(raw, Chamber.HOUSE, url)
    assert oc.committee == "House Tribal Affairs"


def test_moved_out_of_committee_committee_resolved_from_url_url_encoded():
    """HL%26C in URL → 'House Labor & Commerce'."""
    raw = "(H) LABOR & COMMERCE at 03:15 PM BARNES 124 | (H) Moved HB 110 Out of Committee"
    url = "https://www.akleg.gov/basis/Meeting/Detail/?Meeting=HL%26C 2025-05-09 15:15:00&Bill=HB 110"
    [oc] = parse_outcomes_from_raw_text(raw, Chamber.HOUSE, url)
    assert oc.outcome_type == OutcomeType.MOVED_OUT_OF_COMMITTEE
    assert oc.committee == "House Labor & Commerce"


def test_senate_finance_resolved_from_url():
    raw = "(S) FINANCE at 09:00 AM | (S) Heard & Held"
    url = "https://www.akleg.gov/basis/Meeting/Detail/?Meeting=SFIN 2025-05-12 09:00:00&Bill=SB 20"
    [oc] = parse_outcomes_from_raw_text(raw, Chamber.SENATE, url)
    assert oc.committee == "Senate Finance"


def test_floor_session_url_does_not_set_committee():
    """Journal-page URLs (floor actions) must never derive a committee."""
    raw = (
        "(H) JUD RPT 5DP | (H) DP: COSTELLO, MINA, EISCHEID, VANCE, GRAY | "
        "(H) FN1: ZERO(DPS) | (H) Moved HB 384 Out of Committee"
    )
    url = "https://www.akleg.gov/basis/Journal/Pages/34?Chamber=H&Bill=HB%20384&Page=2329"
    outcomes = parse_outcomes_from_raw_text(raw, Chamber.HOUSE, url)
    moc = next(o for o in outcomes if o.outcome_type == OutcomeType.MOVED_OUT_OF_COMMITTEE)
    assert moc.committee is None


def test_unknown_committee_code_returns_none():
    """Committee codes outside the known map fall through to None — never
    fabricate a label like 'House SHB53' for a one-off conference committee."""
    raw = "(H) Heard & Held"
    url = "https://www.akleg.gov/basis/Meeting/Detail/?Meeting=HHB53 2025-05-16 16:00:00&Bill=HB 53"
    [oc] = parse_outcomes_from_raw_text(raw, Chamber.HOUSE, url)
    assert oc.committee is None


def test_moved_out_of_committee_with_bill_id():
    raw = "(H) TRIBAL AFFAIRS at 08:00 AM DAVIS 106 | (H) Moved HB 384 Out of Committee"
    outcomes = parse_outcomes_from_raw_text(raw, Chamber.HOUSE)
    assert _types(outcomes) == {OutcomeType.MOVED_OUT_OF_COMMITTEE}


def test_moved_out_of_committee_senate():
    raw = "(S) FINANCE at 09:00 AM | (S) Moved SB 12 Out of Committee"
    outcomes = parse_outcomes_from_raw_text(raw, Chamber.SENATE)
    assert _types(outcomes) == {OutcomeType.MOVED_OUT_OF_COMMITTEE}
    assert outcomes[0].chamber == Chamber.SENATE


def test_referred_to_rules_uppercase_journal_line():
    """Referred-to-Rules always lands on '{Chamber} Rules' — and on a journal
    URL the URL extractor returns nothing, so the fallback drives it."""
    raw = (
        "(H) JUD RPT 5DP | (H) DP: COSTELLO, MINA, EISCHEID, VANCE, GRAY | "
        "(H) FN1: ZERO(DPS) | (H) REFERRED TO RULES"
    )
    url = "https://www.akleg.gov/basis/Journal/Pages/34?Chamber=H&Bill=HB%20384&Page=2329"
    outcomes = parse_outcomes_from_raw_text(raw, Chamber.HOUSE, url)
    assert _types(outcomes) == {OutcomeType.REFERRED_TO_COMMITTEE}
    [oc] = outcomes
    assert oc.committee == "House Rules"
    assert oc.description == "Referred to Rules"


def test_referred_to_rules_senate_chamber_in_committee_field():
    raw = "(S) RULES TO CALENDAR | (S) Referred to Rules"
    outcomes = parse_outcomes_from_raw_text(raw, Chamber.SENATE)
    by_type = {o.outcome_type: o for o in outcomes}
    assert OutcomeType.REFERRED_TO_COMMITTEE in by_type
    assert by_type[OutcomeType.REFERRED_TO_COMMITTEE].committee == "Senate Rules"


def test_no_match_returns_empty():
    raw = "(H) READ THE FIRST TIME - REFERRALS"
    assert parse_outcomes_from_raw_text(raw, Chamber.HOUSE) == []


def test_meeting_cancelled_no_outcome():
    raw = (
        "(H) TRIBAL AFFAIRS at 09:00 AM DAVIS 106 | "
        "(H) -- MEETING CANCELED --"
    )
    assert parse_outcomes_from_raw_text(raw, Chamber.HOUSE) == []


def test_committee_referrals_TRB_JUD_do_not_match_referred_to_rules():
    """The "(H) TRB, JUD" referral line must not match the Rules pattern."""
    raw = "(H) TRB, JUD"
    assert parse_outcomes_from_raw_text(raw, Chamber.HOUSE) == []


def test_committee_report_does_not_match():
    """Lines like '(H) TRB RPT 6DP' shouldn't fire any pattern."""
    raw = "(H) TRB RPT 6DP | (H) DP: SCHWANKE, FRIER | (H) FN1: ZERO(DPS)"
    assert parse_outcomes_from_raw_text(raw, Chamber.HOUSE) == []


def test_duplicate_phrase_collapses_to_one_outcome():
    raw = "(H) Heard & Held | (H) Heard & Held"
    outcomes = parse_outcomes_from_raw_text(raw, Chamber.HOUSE)
    assert len(outcomes) == 1


def test_multiple_distinct_types_all_emit():
    """An event whose raw_text contains both Heard & Held *and* Moved Out
    of Committee should yield both — guards against pattern bleed."""
    raw = "(H) Heard & Held | (H) Moved HB 384 Out of Committee"
    outcomes = parse_outcomes_from_raw_text(raw, Chamber.HOUSE)
    assert _types(outcomes) == {
        OutcomeType.HEARD_AND_HELD,
        OutcomeType.MOVED_OUT_OF_COMMITTEE,
    }


def test_moved_pattern_does_not_cross_pipe_separators():
    """`Moved` on one row must not match `Out of Committee` from a later row
    that belongs to a different action."""
    # The Mistral guidance treats pipe-separated lines as distinct actions;
    # the regex limits the gap between "Moved" and "Out of Committee" so a
    # spurious join across rows doesn't fire.
    raw = "(H) Moved to bottom of calendar | (H) RULES TO CALENDAR"
    outcomes = parse_outcomes_from_raw_text(raw, Chamber.HOUSE)
    assert OutcomeType.MOVED_OUT_OF_COMMITTEE not in _types(outcomes)
