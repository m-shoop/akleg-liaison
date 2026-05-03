import { driver } from "driver.js";
import "driver.js/dist/driver.css";

export function createHearingsTour({
  isEditor = false,
  isLoggedIn = false,
  activeView = "list",
  canSystemEdit = false,
} = {}) {
  const isCalendar = activeView === "calendar";

  return driver({
    showProgress: true,
    steps: [
      {
        element: "#tour-view-toggle",
        popover: {
          title: "View Toggle",
          description:
            "Switch between List view and Calendar view. Calendar view lays hearings out on a grid — 1 or 3 days at once on desktop, one day at a time on mobile. List view groups hearings by day.",
        },
      },

      {
        element: "#tour-default-settings",
        popover: {
          title: "Default Page Settings",
          description:
            "Reset filters, criteria, search, and view options on this page back to their starting values.",
        },
      },

      ...(isLoggedIn && !isCalendar
        ? [
            {
              element: "#tour-saved-reports",
              popover: {
                title: "Saved Reports",
                description: canSystemEdit
                  ? "Save the criteria you've built as a named report and re-load it with one click. Click any badge to load that report. ★ marks your default — it loads automatically when you return to this page. System reports are visible to all users; user reports are private to you. Toggle 'Include Inactive' to see archived reports."
                  : "Pick a report to load it — these are the system reports built by your admin. ★ marks your default and loads automatically when you return to this page; use the ☆/★ Default Report button at the bottom-right of this section to set or unset your default for the loaded report. Toggle 'Include Inactive' to see archived reports.",
              },
            },
          ]
        : []),

      ...(!isCalendar && canSystemEdit
        ? [
            {
              element: "#tour-report-criteria",
              popover: {
                title: "Report Criteria",
                description:
                  "Build the list of hearings you want to see by stacking rows of criteria — committee, chamber, date range, agenda content, hearing notes, and more. Combine rows with AND / OR in the Custom Logic box for complex queries. Click Run Query to apply, then Save or Save As to keep the result as a report.",
              },
            },
          ]
        : []),

      ...(isEditor
        ? [
            {
              element: "#tour-refresh-hearings",
              popover: {
                title: "Refresh from akleg.gov",
                description:
                  "Pull the latest schedule directly from akleg.gov for a date range. Use the shortcuts (Today / Last Week / This Week / Next Week) to quickly fill the dates. Refreshes run in the background.",
              },
            },
          ]
        : []),

      ...(isCalendar
        ? [
            {
              element: "#tour-calendar-start-date",
              popover: {
                title: "Calendar Starting Date",
                description:
                  "The first day shown in the calendar grid. When you switch back to List view, this date carries over as the From date in your Report Criteria.",
              },
            },
            {
              element: "#tour-calendar-nav",
              popover: {
                title: "Calendar Navigation",
                description:
                  "Step forward or backward by the number of days currently shown. Use the 1-day / 3-day toggle to change the column count (mobile is fixed at 1 day).",
              },
            },
          ]
        : [
            {
              element: "#tour-expand-agendas",
              popover: {
                title: "Expand / Collapse Agendas",
                description:
                  "Toggle every hearing's agenda open or closed at once. You can also expand individual hearings by clicking '▸ Show agenda' on each card.",
              },
            },
          ]),

      {
        element: "#tour-legend",
        popover: {
          title: "Agenda Symbols",
          description:
            "Symbols that appear before bill numbers on a hearing agenda: * = first hearing in the bill's first committee of referral, + = teleconferenced, = = previously heard or scheduled.",
        },
      },

      {
        element: "#tour-meetings-search",
        popover: {
          title: "Search",
          description: canSystemEdit
            ? "Filter the hearings shown on this page by committee, bill number, agenda content, location, or your own notes. Search runs locally on the loaded hearings — narrow with Report Criteria first if you don't see what you expect."
            : "Filter the hearings shown on this page by committee, bill number, agenda content, location, or your own notes. Search runs locally on the loaded hearings — pick a different report above if you don't see what you expect.",
        },
      },

      ...(!isCalendar
        ? [
            {
              element: "#tour-first-meeting",
              popover: {
                title: "Hearing Card",
                description:
                  "Each card shows the date, time, committee, and location. Click '▸ Show agenda' to expand the bill list. Click a committee name or bill number to open it on akleg.gov. Use the Notes column to attach internal DPS notes — they persist across refreshes.",
              },
            },
          ]
        : [
            {
              element: "#tour-first-calendar-meeting",
              popover: {
                title: "Calendar Hearing Block",
                description:
                  "Each block shows the chamber and committee (e.g. (H) FINANCE) or floor hearing label. Click a block to open a detail overlay with the full agenda, location, sync time, and notes.",
              },
            },
          ]),
    ],
  });
}
