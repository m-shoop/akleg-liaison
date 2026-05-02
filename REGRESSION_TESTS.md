# Regression Test Scripts — Leg Up (akleg-liaison)

Manual regression tests to verify core functionality after changes. Run before deploying.

---

## Prerequisites

- App is running (frontend + backend), with the Postmark email provider in dev/sandbox mode (or a way to read outbound mail — the dev backend logs the email body and any token URL)
- **Admin** test user with full permissions: `bill:track`, `bill:query`, `bill-tags:view`, `bill-tags:edit`, `hearing:query`, `hearing:hide`, `hearing-notes:view`, `hearing-notes:edit`, `workflow:view-all`, `hearing-assignment:view-auto-suggestions`, `user-report:edit`, `system-report:edit`, `email-template:edit`
- **Standard** test user with the read-side permissions only (no `workflow:view-all`, no `*-report:edit`) — used to verify permission gating on the Requests/Assignments pages
- A third user record that has been **pre-created by an admin but not yet activated** (status `inactive`, no password) — required for registration/activation tests (TS-21, TS-22)
- At least one bill is tracked; at least one tracked bill has a scheduled hearing
- A second browser session or incognito window available for session expiry tests
- Login uses an **email address** (not a username) — confirm the account is reachable via email before starting Account Lifecycle tests
- Ability to inspect the backend log or dev mailbox to copy activation/reset token URLs — none of these tests rely on a real inbox

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

---

## Account Lifecycle (feature/unique-logins)

> **What "unique logins" actually means here:** the branch moves the app to per-user email-based accounts and adds an email-driven invite / activation / password-reset workflow. It does **not** enforce a single concurrent session per user — multiple browsers/tabs can hold valid tokens for the same account at the same time. Test for the workflow behavior, not for session uniqueness.
>
> Token retrieval: when a test step says "click the link in the email," the dev backend writes the activation/reset URL to the server log. Copy it from there.

---

### TS-21 — Request a registration / activation email

**Setup:** An admin has pre-created a user record (status `inactive`, no password). You know the email address.

**Steps:**
1. From the login page, click **Register** (or navigate to `/register`).
2. Enter the inactive account's email and submit.
3. Repeat the request for: an already-active email, a deleted email, and an email with no account.
4. Submit the same valid request 11 times in one hour from the same IP.

**Expected:**
- Inactive account → success state: "Check your inbox," 30-minute validity message.
- Already-active account → message offering a redirect to **Forgot Password**.
- Deleted account → "Account unavailable / contact support."
- Unknown email → "Account not found / contact support."
- 11th submission within an hour returns a rate-limit error (10/hour/IP).
- Backend log shows an activation URL for the inactive case only.

---

### TS-22 — Activate account via registration email link

**Setup:** TS-21 completed for the inactive account; activation URL captured from the backend log.

**Steps:**
1. Open the activation URL in a fresh incognito window.
2. Confirm the **Set Password** form appears with no JS errors.
3. Try each of these passwords and observe the live requirement indicators:
   - `short` → too short
   - `nouppercaseornumber!!!!` → missing number
   - `NoSpecial1234567` → missing special character
   - `Valid-Password-1` → all four indicators turn green
4. Enter mismatched values in **Password** / **Confirm Password**, then matching ones.
5. Submit with a valid password and matching confirm.
6. Open the same activation URL again in another tab.

**Expected:**
- Each requirement (≥ 12 chars, letter, number, special) flips ✓/✗ as you type.
- Mismatched confirm disables submit and shows an error.
- Valid submit returns success and redirects to login with a "Account activated, please log in" message.
- Reused URL shows "Link no longer valid" — the token is single-use.
- After log in with the new password, the user's permissions match what the admin assigned.

---

### TS-23 — Expired activation / reset link

**Setup:** Generate (or wait on) an activation or reset token whose `exp` is in the past. Easiest: ask a developer to issue one with a 1-minute TTL.

**Steps:**
1. Wait until the token has expired.
2. Open the activation URL.

**Expected:**
- Page redirects to `/login?tokenExpired=registration` (or `=password_reset`).
- Login page renders the **token-expired banner** at top: "Your activation/reset link has expired. Request a new one below."
- Banner disappears once you navigate away or successfully log in.
- The expired token has been deleted server-side (re-opening the same URL shows "Link no longer valid", not the expiry banner).

---

### TS-24 — Forgot Password — status branches

**Steps:** From `/forgot-password`, enter and submit each of the following emails in turn:
1. An **active** account's email.
2. An **inactive** (pre-created, no password) account's email.
3. A **deleted** account's email.
4. An **unknown** email.

**Expected:**
- Active → "Request reset email" button appears; clicking it sends the reset email and shows a success state.
- Inactive → "Account not yet activated" with an option to send the activation email instead (same flow as TS-21).
- Deleted → "Account unavailable."
- Unknown → "Account not found."
- 11+ reset requests / hour / IP return a rate-limit error.

---

### TS-25 — Reset password end-to-end

**Setup:** Active account; TS-24 step 1 completed; reset URL captured.

**Steps:**
1. Open the reset URL.
2. Set a **new** password that meets all four requirements.
3. Try logging in with the **old** password.
4. Log in with the new password.
5. Open the same reset URL a second time.

**Expected:**
- Set Password form behaves exactly as in TS-22.
- Old password is rejected at login ("Incorrect email or password").
- New password logs in successfully; permissions intact.
- Reused reset URL shows "Link no longer valid."

---

### TS-26 — Login (email-based) and logout

**Steps:**
1. Navigate to `/login`.
2. Sign in with valid email + password — verify auth-gated UI loads.
3. Sign out via the navbar.
4. Sign in with a deactivated / inactive account.
5. Sign in with a wrong password.
6. Submit a malformed email.

**Expected:**
- Valid login → JWT in localStorage as `akleg_token`; navbar shows the email + Logout.
- Logout → token cleared from localStorage; auth-gated UI hidden; redirect to `/`.
- Inactive account → "Account is not active."
- Wrong password / unknown email → "Incorrect email or password" (same error for both — no user enumeration).
- Permissions array in the JWT matches what the user actually has access to in the UI.

---

### TS-27 — Reauth modal after token expiry (updated)

**Setup:** Same as TS-09. Replaces TS-09 with the addition of the navbar warning indicator.

**Steps:**
1. Run TS-09 to put an expired token into localStorage and reload.
2. Observe the navbar.
3. Trigger an authenticated action (e.g., edit DPS notes).

**Expected:**
- A **⚠ warning indicator** appears next to the username in the navbar while the token is expired.
- SessionExpiredBanner renders at the top of the page.
- Reauth modal appears on the first protected action; entering the correct password clears both the banner and the warning indicator.
- Wrong password keeps the modal open with an error.
- After successful reauth, the originally attempted action can be retried without a page reload.

---

## Hearing Assignments (feature/unique-logins)

> Hearing Assignments live on the Hearings page in a panel/section. Auto-suggestions are produced by a background job (`hearing_assignment_suggester.py`) that runs at 4:45 AM/PM Juneau time. For deterministic testing, ask a developer to seed an `auto_suggested_hearing_assignment` workflow or trigger the job manually.

---

### TS-28 — Manually create a hearing assignment

**Setup:** Logged in as **Admin** (has `workflow:view-all`). At least one upcoming hearing with at least one tracked bill on its agenda.

**Steps:**
1. Navigate to **Hearings**, locate the target hearing card, expand its assignments panel.
2. Click **+ Create Assignment**.
3. In the modal: pick an assignee via the email combobox, optionally pick a tracked bill on the agenda, choose **Monitoring** (default), submit.
4. Repeat for another assignment with type **Awareness** (no specific bill).

**Expected:**
- Combobox suggests active users as you type (calls `GET /workflows/assignees?q=...`).
- Submitting creates the workflow and the new row appears in the panel with status **Assigned** and the chosen type badge.
- The assignee appears in the row; the bill (if specified) renders as a chip/link.
- Standard user (no `workflow:view-all`) does not see the **+ Create Assignment** button.

---

### TS-29 — Auto-suggested hearing assignments

**Setup:** A future hearing has a tracked bill on the agenda; that bill has a prior completed assignment to user X. Run the suggester job (or wait for the 4:45 cron) so an `auto_suggested_hearing_assignment` workflow is created.

**Steps:**
1. Log in as Admin (has `hearing-assignment:view-auto-suggestions`).
2. Navigate to Hearings, find the seeded hearing.
3. Note the assignment status badge — should read **Suggested** with assignee = X.
4. Log out, then log in as a user that **lacks** `hearing-assignment:view-auto-suggestions`.
5. Re-check the same hearing.

**Expected:**
- Admin sees the row with **Suggested** status.
- User without the permission does not see the suggested row at all.
- The suggester does not create a duplicate suggestion if one (open or completed) already exists for the same bill+hearing.
- Hearings whose bill has no prior assignee are **not** auto-suggested (verify a known case, or cross-check the "Has Unassigned Tracked Bills" filter from TS-34).

---

### TS-30 — Confirm or discard an auto-suggestion (admin)

**Setup:** TS-29 completed; a row exists with status **Suggested**.

**Steps:**
1. As Admin, click the suggested row to open the detail modal.
2. Confirm the suggestion (action: **hearing_assigned**).
3. Repeat for a second suggested row but choose **Discard** instead.

**Expected:**
- Confirm → status flips to **Assigned**, the original assignee is preserved, the row's history shows both `auto_suggested_hearing_assignment` and `hearing_assigned` entries.
- Discard → status flips to **Discarded**, the row is hidden by default but visible if a "show discarded" toggle is enabled (or via the assignment-status filter in TS-34).

---

### TS-31 — Mark assignment complete (assignee)

**Setup:** An assignment exists with status **Assigned** and assignee = the currently logged-in user.

**Steps:**
1. Log in as the assignee (does **not** need `workflow:view-all`).
2. Open the assignment detail.
3. Click **Mark Complete**.
4. Try to mark a different user's assignment complete.

**Expected:**
- Own assignment moves to **Completed**.
- The other user's assignment offers no Mark Complete control (button hidden or disabled).
- Admin can mark any assignment complete on behalf of the assignee.

---

### TS-32 — Request reassignment

**Setup:** An assignment exists with status **Assigned** and assignee = current user.

**Steps:**
1. As the assignee, open the assignment.
2. Click **Request Reassignment**, enter the suggested new assignee email, submit.
3. Log in as Admin; open the same assignment.
4. Approve the reassignment (assign to the suggested email or override).

**Expected:**
- Assignee's request flips status to **Reassigned (pending)** with the suggested email visible.
- Admin sees the request and can complete it; status returns to **Assigned** with the new assignee.
- Original assignee no longer sees Mark Complete on this row.

---

### TS-33 — Cancel an assignment with reason

**Setup:** Logged in as Admin; an open assignment exists.

**Steps:**
1. Open the assignment detail.
2. Choose **Cancel**, enter a cancellation reason, submit.
3. Try to cancel without entering a reason.

**Expected:**
- Cancel without reason is blocked client-side (validation message).
- Cancel with reason sets status to **Canceled**; reason is visible on the row's history.
- Standard user (no `workflow:view-all`) cannot cancel — control is hidden.

---

### TS-34 — Filter hearings by assignment status / unassigned tracked bills

**Setup:** A mix of hearings exists: some Assigned, some Suggested, some Completed, some with tracked bills but no assignment.

**Steps:**
1. On Hearings, open the **HearingsFilterBar**.
2. Multi-select **Assigned** + **Suggested** in the assignment-status filter.
3. Clear; enable **Has Unassigned Tracked Bills**.
4. Clear; filter by a specific assignee email.

**Expected:**
- Step 2: only hearings whose assignments match the chosen statuses remain visible.
- Step 3: only hearings with at least one tracked bill on the agenda **and** no open/completed assignment for that bill are visible — this is the workflow used to find hearings needing manual assignment.
- Step 4: only hearings with at least one assignment for the chosen assignee are visible.
- Switching filters never triggers a full page reload.

---

## Bill Tracking Requests & Tasks Page (feature/unique-logins)

> The new **Tasks** / **Requests** page (route in `App.jsx`, e.g., `/requests` or `/tasks`) has two tabs: **Requests** (bill tracking workflow) and **Assignments** (hearing assignments). Both share the new stacking-criteria filter system and saved-reports bar.

---

### TS-35 — Submit a bill tracking request

**Setup:** Logged in as a user **without** `bill:track`. At least one untracked bill exists.

**Steps:**
1. On the Home page (or wherever request entry lives), find an untracked bill.
2. Click the **Request to Track** action, optionally add a note, submit.
3. Verify the request appears under **Requests → Open** on the Tasks page.

**Expected:**
- A new workflow row is created with type `bill_tracking` and status **Open**, outcome **Pending**.
- The current user is recorded as the requestor.
- The same user cannot submit a duplicate open request for the same bill (button disabled or duplicate prevented at submit).

---

### TS-36 — Approve a bill tracking request

**Setup:** Open request from TS-35. Logged in as Admin (`workflow:view-all` + `bill:track`).

**Steps:**
1. Navigate to **Tasks → Requests**.
2. Open the row for the pending request.
3. Click **Approve**.

**Expected:**
- Workflow status flips to **Closed**, outcome **Approved**.
- The bill is now marked tracked (verify on Home).
- The original requestor sees the approved status next time they load the page.

---

### TS-37 — Deny a bill tracking request

**Setup:** Another open request exists.

**Steps:**
1. As Admin, open the row, click **Deny**, enter a reason if prompted, submit.

**Expected:**
- Status **Closed**, outcome **Denied**, reason captured in history.
- The bill is not tracked as a result.
- Standard user without `workflow:view-all` does not see Approve/Deny — only the read-only view of their own requests.

---

### TS-38 — Tab navigation between Requests and Assignments

**Steps:**
1. On the Tasks page, click the **Requests** tab and apply a filter.
2. Switch to the **Assignments** tab and apply a different filter.
3. Switch back to **Requests**.

**Expected:**
- Each tab maintains its own filter state independently.
- The active tab's data set is what gets exported / paginated.
- Pagination resets to page 1 on tab switch (or persists, depending on implementation — verify the behavior is consistent and not stale across tabs).

---

### TS-39 — RequestsFilterBar — basic + advanced filters

**Setup:** Several requests exist with varying status, outcome, requestor, bill session, dates.

**Steps:**
1. On **Tasks → Requests**, set **Status: Open**.
2. Set **Outcome: Pending**.
3. Type a bill number in the bill-number input.
4. Expand **Advanced**; set a **Requested On** date range, a **Bill Title** contains-match, and **Session** multi-select.
5. As Admin, set **Requested By** to a specific email.
6. Click **Apply**.

**Expected:**
- The summary line above the table reflects every active filter in human-readable form.
- The table only shows rows matching all filters.
- Standard user does not see the **Requested By** input (gated on `workflow:view-all`).
- Clearing all filters and re-applying restores the unfiltered list.

---

### TS-40 — Stacking criteria, multi-row + boolean expression

**Setup:** TS-39 prerequisites; desktop viewport (mobile collapses to a single row).

**Steps:**
1. Add criterion row **A**: Status = Open.
2. Add row **B**: Outcome = Pending.
3. Add row **C**: Requestor email = X.
4. Leave the expression box empty → click **Apply**.
5. Set the expression to `A AND (B OR C)` → click **Apply**.
6. Set an invalid expression (`A AND`) → observe.
7. Add an unused row **D** (not referenced in the expression) → observe.
8. Drag-reorder rows.

**Expected:**
- Empty expression = implicit `AND` across all rows.
- `A AND (B OR C)` filters correctly per the boolean.
- Invalid expression disables **Apply** and shows a validation error.
- Unused row shows a warning badge; **Apply** is blocked until either the row is removed or referenced.
- Drag-reorder updates row labels (A, B, C…) consistently and the expression auto-rewrites or warns if labels change.
- Mobile width: only the basic single-row filter is shown — the stacking UI is hidden.

---

### TS-41 — Save a user-level report

**Setup:** A non-trivial filter set is applied on **Tasks → Requests**. Logged in as a user with `user-report:edit`.

**Steps:**
1. Click **Save As**, name it `My Open Requests`, choose publication level **User**, save.
2. Refresh the page.
3. Open the **Saved Reports** bar.

**Expected:**
- Report appears in the user's Saved Reports list after save and persists across reloads.
- Re-saving with the same name returns a 409 "name already in use" error.
- A user without `user-report:edit` sees the **Save As** button disabled or hidden.

---

### TS-42 — Save a system-level report

**Setup:** Logged in as Admin (`system-report:edit`).

**Steps:**
1. Build a filter set, click **Save As**, choose publication level **System**, name it `Stale Open Requests`, save.
2. Log out; log in as a Standard user.
3. Open the Saved Reports bar.

**Expected:**
- The system report is visible to all users on the same registry (`bill_tracking_requests`).
- Admin can edit the system report; Standard user cannot (Edit / Delete are hidden).
- A user without `system-report:edit` does not see the **System** publication-level option in the Save As modal.

---

### TS-43 — Load and run a saved report

**Setup:** TS-41 (or TS-42) completed.

**Steps:**
1. Click the saved-report badge in the Saved Reports bar.
2. Verify the criteria rows and expression load into the StackingCriteria UI.
3. Modify a row and observe the **Apply** button.
4. Click **Run Query** without modifying.

**Expected:**
- All criteria rows + expression hydrate exactly as saved.
- Modifying a row marks the report dirty and exposes **Apply** (or "unsaved changes" indicator).
- Running an unmodified saved report executes without prompting to save.

---

### TS-44 — Set / unset default saved report

**Setup:** At least two saved reports exist on the same registry.

**Steps:**
1. In the Saved Reports bar, mark report **A** as default.
2. Reload the Tasks page.
3. Mark report **B** as default.
4. Unset the default.

**Expected:**
- After step 2, report **A**'s criteria load automatically on page entry.
- After step 3, **A** is no longer default and **B** is — only one default per user per registry.
- After step 4, the page loads with no preset criteria (default empty filter).
- Default is per-user — confirm by signing in as a different user and seeing no default applied.

---

### TS-45 — Deactivate a saved report

**Setup:** A saved report exists.

**Steps:**
1. Open the report's edit menu, toggle **Active** off, save.
2. Observe the report in the Saved Reports bar.
3. Reactivate it.

**Expected:**
- Inactive report renders in a locked state (cannot edit content); only **Reactivate** is available.
- Inactive reports can still be loaded for read-only viewing.
- Reactivating restores full edit capability.

---

## Notes

- For permission-gated tests, run the test both **with** and **without** the required permission to verify gating.
- Check the browser console for JavaScript errors after each test case.
- After any scrape or bill refresh, wait for the background job to complete before asserting final state.
- The branch name "unique-logins" refers to the per-user email-based account model, **not** to any single-session-per-user enforcement. Multiple browsers can hold valid tokens for the same account simultaneously — that is expected, not a bug.
- For tests that require email tokens (TS-21–TS-25), read the activation/reset URL out of the backend log rather than waiting on a real inbox; the dev backend surfaces the URL there in dev/sandbox mode.
