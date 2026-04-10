# Regression Test Scripts — Leg Up (akleg-liaison)

Manual regression tests to verify core functionality after changes. Run before deploying.

---

## Prerequisites

- App is running (frontend + backend)
- Test user account exists with full permissions (`bill:track`, `bill:query`, `bill-tags:view`, `bill-tags:edit`, `hearing:query`, `hearing:hide`, `hearing-notes:view`, `hearing-notes:edit`)
- At least one bill is tracked; at least one tracked bill has a scheduled hearing
- A second browser session or incognito window available for session expiry tests

---

## Test Cases

---

### TS-01 — Export a PDF (bills only)

**Setup:** Log in. Ensure at least one bill is tracked.

**Steps:**
1. Navigate to the Home page.
2. Do **not** set a meeting date range (leave From/To blank).
3. Click **Export PDF**.

**Expected:**
- A PDF downloads (or opens in a new tab).
- PDF contains the report header (title, subtitle, updated date).
- PDF includes a bill list with tracked bills.
- No meeting schedule section appears.
- AI-generated disclaimer is present.

---

### TS-02 — Export a PDF with hearings

**Setup:** Log in. Ensure at least one tracked bill has a hearing scheduled within the chosen date range.

**Steps:**
1. Navigate to the Home page.
2. Set a **From** and **To** date range that covers at least one upcoming hearing.
3. Click **Export PDF**.

**Expected:**
- PDF downloads.
- PDF contains both the bill list section **and** a meeting schedule section.
- Meeting schedule shows committee name, date, time, location.
- Agenda items list relevant bill numbers.
- DPS notes (if any) appear under each meeting.
- Last sync timestamp appears for each meeting.

---

### TS-03 — Load all tracked bills

**Setup:** Log in (or use unauthenticated session). At least one bill is marked as tracked in the database.

**Steps:**
1. Navigate to the Home page.
2. Wait for the page to finish loading.

**Expected:**
- All tracked bills appear as bill cards.
- Each card shows: bill number, title, status, introduced date, last sync date.
- Untracked bills are **not** shown (unless the untracked toggle was previously enabled).
- No console errors or loading spinners stuck.

---

### TS-04 — Load all untracked bills

**Setup:** Log in. Untracked bills exist in the database.

**Steps:**
1. Navigate to the Home page.
2. Locate the **Show Untracked** toggle and enable it.
3. Wait for the additional bills to load.

**Expected:**
- Untracked bills appear below (or mixed with) tracked bills.
- Untracked bills are visually distinct (e.g., no tracking highlight).
- Toggle can be turned off again, hiding untracked bills without a page reload.

---

### TS-05 — Load all hearings for this week

**Setup:** Hearings exist in the database for the current week.

**Steps:**
1. Navigate to the Meetings page.
2. Click the **This Week** shortcut button.
3. Wait for meetings to load.

**Expected:**
- From/To dates auto-fill with the current week's Monday–Friday (or equivalent range).
- Meeting cards appear, grouped by day.
- Each card shows: committee name, chamber, date, time, location.
- Agenda items are visible (or expandable).
- No meetings outside the selected date range appear.

---

### TS-06 — Load all hearings for next week

**Setup:** Hearings are scheduled for next week.

**Steps:**
1. Navigate to the Meetings page.
2. Click the **Next Week** shortcut button.
3. Wait for meetings to load.

**Expected:**
- From/To dates update to next week's range.
- Meetings for next week appear, grouped by day.
- Meetings from this week or prior weeks are not shown.

---

### TS-07 — Update report header, export PDF

**Steps:**
1. Navigate to the Home page.
2. Locate the **Report Header** editor (expand if collapsed).
3. Change the **Title** field to a unique test string (e.g., `Regression Test Header`).
4. Change the **Subtitle** field.
5. Click **Export PDF**.
6. Reopen the page (refresh) and check the header editor again.

**Expected:**
- The exported PDF reflects the updated title and subtitle.
- After page refresh, the header editor retains the custom values (persisted in localStorage).
- Resetting the header (if a reset button exists) restores the default values.

---

### TS-08 — Query a bill

**Setup:** Log in with `bill:query` permission. At least one bill is tracked.

**Steps:**
1. Navigate to the **Query Bill** page (visible in nav for users with `bill:query`).
2. Select a tracked bill from the dropdown.
3. Click **Query** (or equivalent submit button).
4. Wait for the job to complete.

**Expected:**
- A background job is enqueued and polled.
- Success toast or message appears when the job completes.
- The bill's **last sync** timestamp updates on the Home page.
- No error toasts appear.

**Also verify:**
- Users **without** `bill:query` permission do not see the Query Bill page in the nav.

---

### TS-09 — Session expires

> **How expiry simulation works:** `akleg_token` in localStorage is only read **once at page load** to initialize React state. Deleting it from DevTools while the app is running has no effect — the in-memory token is still valid and API calls will succeed. To simulate an expired session you must replace the token with an already-expired one **before** the app initializes it.

**Setup:** Log in. Copy the current `akleg_token` value from DevTools > Application > Local Storage.

**Steps to simulate expiry:**
1. Log in normally so a valid token exists.
2. In DevTools, craft or obtain a JWT with a past `exp` claim. The easiest method: decode the current token at [jwt.io](https://jwt.io), change `exp` to a Unix timestamp in the past, and re-encode with the same secret — **or** ask a developer to issue a token with a 1-minute expiry for testing.
3. In DevTools > Application > Local Storage, **replace** (not delete) the value of `akleg_token` with the expired token.
4. **Reload the page.** (Deletion without reload does not trigger expiry UI — the old token stays in React state.)
5. Attempt an action that requires auth (e.g., edit DPS notes, track a bill).

**Expected:**
- On page load, **SessionExpiredBanner** appears at the top of the page.
- A **Reauth Modal** prompts for password re-entry when an authenticated action is attempted.
- After re-entering the correct password, the session is restored and the action can be retried.
- DPS note text fields re-enable after successful reauth.
- Entering an incorrect password shows an error; the modal remains open.

**Note:** Deleting `akleg_token` from localStorage without a page reload does **not** expire the session — the app continues using the token held in React state and API calls will succeed until the token's actual `exp` time.

---

### TS-10 — Log in and log out

**Steps:**
1. Navigate to `/login`.
2. Enter valid credentials and click **Sign In**.
3. Verify the home page loads with auth-gated controls visible.
4. Click **Logout** in the navbar.

**Expected:**
- Login succeeds; JWT stored in localStorage.
- Auth-gated elements appear (track buttons, scrape button, DPS notes editing).
- After logout, JWT is cleared from localStorage.
- Auth-gated elements disappear or become read-only.
- Navigating to `/login` again works without errors.

**Negative case:** Enter invalid credentials. Expect an error message; no redirect.

---

### TS-11 — Search / filter bills

**Steps:**
1. Navigate to the Home page with tracked bills loaded.
2. Type a **bill number** (e.g., `HB 123`) in the search box.
3. Clear the search, then type a **keyword** known to appear in a bill title.
4. Clear the search, then type a **committee name**.

**Expected:**
- Bill list filters in real time (no submit button required).
- Only matching bills remain visible.
- Clearing the search restores all tracked bills.
- Search is case-insensitive.

---

### TS-12 — Track and untrack a bill

**Setup:** Log in with `bill:track` permission. At least one untracked bill is visible (enable **Show Untracked**).

**Steps:**
1. On the Home page, find an **untracked** bill.
2. Click the **Track** button on that bill card.
3. Wait for the background refresh to complete.
4. Locate a **tracked** bill and click **Untrack**.

**Expected:**
- Tracking a bill: bill moves to the tracked state; a background data refresh is triggered; success feedback appears.
- Untracking a bill: bill moves to untracked state; it disappears from the main list when **Show Untracked** is off.
- No page reload required.

---

### TS-13 — Search meetings

**Setup:** Meetings are loaded for a date range.

**Steps:**
1. Navigate to Meetings page, load a week of hearings.
2. Type a **committee name** in the search box.
3. Clear; search for a **bill number** that appears in an agenda.
4. Clear; search for text that appears in a **DPS note** (requires `hearing-notes:view`).

**Expected:**
- Only meetings matching the search term remain visible.
- Searching by bill number surfaces meetings that have that bill on the agenda.
- DPS note search works for users with `hearing-notes:view`.
- Clearing restores all meetings.

---

### TS-14 — Edit DPS notes on a meeting

**Setup:** Log in with `hearing-notes:edit`. At least one meeting is visible.

**Steps:**
1. Navigate to Meetings and load a date range.
2. Find a meeting card and click/focus the **DPS Notes** text area.
3. Enter a test note (e.g., `Regression test note - [date]`).
4. Navigate away and return (or reload the page with the same date range).

**Expected:**
- Notes field is editable (not read-only) for users with `hearing-notes:edit`.
- After navigating away and returning, the note persists (saved to the backend).
- Users **without** `hearing-notes:edit` see notes as read-only or hidden.

---

### TS-15 — Export meeting to calendar

**Steps:**
1. Navigate to Meetings page with at least one meeting loaded.
2. Click the **Export to Calendar** (iCal) button on a meeting card.

**Expected:**
- A `.ics` file downloads.
- Opening the file in a calendar app shows the correct date, time, and location.
- DPS notes (if any) appear in the event description.
- Time is correct for Alaska local time (AKST/AKDT).

---

### TS-16 — Scrape meetings

**Setup:** Log in with `hearing:query` permission.

**Steps:**
1. Navigate to the Meetings page.
2. Set a date range.
3. Click the **Scrape** button.
4. Wait for the job to complete (progress indication expected).

**Expected:**
- A background scrape job is enqueued.
- Progress or a spinner indicates the job is running.
- On completion, a success message shows the count of meetings refreshed.
- The meeting list refreshes with updated data.
- Users **without** `hearing:query` do not see the Scrape button.

---

### TS-17 — Outcome filter

**Steps:**
1. Navigate to the Home page with tracked bills loaded.
2. Open the **Outcome Filter** dropdown.
3. Deselect all outcome types (use **None** bulk action if available).
4. Re-select a single outcome type (e.g., "Passed").
5. Use **All** bulk action to restore all outcomes.

**Expected:**
- Bills with no outcomes of the selected type are filtered out.
- Bills with outcomes matching the selected type remain visible.
- **All** restores the full bill list.
- Filter does not trigger a page reload.

---

### TS-18 — Show/hide inactive meetings

**Setup:** Log in. At least one deactivated (inactive) meeting exists in the database.

**Steps:**
1. Navigate to Meetings and load a date range that includes inactive meetings.
2. Toggle **Show Inactive** on.
3. Toggle **Show Inactive** off.

**Expected:**
- Inactive meetings appear with a visual indicator when the toggle is on.
- If an inactive meeting has DPS notes attached, a **warning alert** appears on that card.
- Toggling off hides inactive meetings again.
- Toggle is only visible to logged-in users.

---

### TS-19 — Filter bills by hearing dates

**Steps:**
1. Navigate to the Home page.
2. Set a meeting date range (From/To).
3. Enable the **Filter by hearing dates** toggle.

**Expected:**
- Only bills that have a scheduled hearing within the selected date range remain visible.
- Bills without a hearing in that range are hidden.
- Disabling the toggle restores all tracked bills.
- The date range used also carries over to the PDF export (TS-02).

---

### TS-20 — Collapse/expand all meeting agendas

**Steps:**
1. Navigate to Meetings and load at least three meetings.
2. Click **Collapse All** (global button).
3. Click **Expand All**.
4. Manually expand one meeting, then collapse it individually.

**Expected:**
- **Collapse All** hides all agenda items; only the meeting header row is visible.
- **Expand All** shows all agenda items for all meetings.
- Individual expand/collapse works independently and does not break the global toggle.

---

## Notes

- For permission-gated tests, run the test both **with** and **without** the required permission to verify gating.
- Check the browser console for JavaScript errors after each test case.
- After any scrape or bill refresh, wait for the background job to complete before asserting final state.
