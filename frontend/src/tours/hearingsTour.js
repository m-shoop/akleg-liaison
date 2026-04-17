import { driver } from "driver.js";
import "driver.js/dist/driver.css";

export function createHearingsTour({ isEditor = false, activeView = "list" } = {}) {
  const isCalendar = activeView === "calendar";

  return driver({
    showProgress: true,
    steps: [
      // Always: view toggle
      {
        element: "#tour-view-toggle",
        popover: {
          title: "View Toggle",
          description:
            "Switch between List view and Calendar view. The calendar view is available on desktop only and shows hearings laid out on a weekly grid.",
        },
      },

      // Always: search
      {
        element: "#tour-meetings-search",
        popover: {
          title: "Search",
          description:
            "Filter hearings by committee name, bill number, description, location, or your own notes. Results update as you type. In calendar view, a banner appears when filtering is active.",
        },
      },

      // Date controls differ per view
      ...(!isCalendar
        ? [
            {
              element: "#tour-date-range",
              popover: {
                title: "Date Range",
                description:
                  "Choose the week or date range you want to view. Hearings load automatically when the dates change.",
              },
            },
          ]
        : [
            {
              element: "#tour-calendar-start-date",
              popover: {
                title: "Starting Date",
                description:
                  "The first day shown in the calendar. When you switch back to List view, this date carries over as the From date.",
              },
            },
            {
              element: "#tour-calendar-nav",
              popover: {
                title: "Calendar Navigation",
                description:
                  "Move forward or backward by the number of days currently shown (3 or 5). Use the 3-day / 5-day toggle to change how many columns are displayed.",
              },
            },
          ]),

      // Controls (editor only) — same in both views
      ...(isEditor
        ? [
            {
              element: "#tour-controls",
              popover: {
                title: "Controls",
                description:
                  "Scrape the latest schedule directly from akleg.gov to pick up any changes. Use the hidden hearings toggle to show or hide hearings marked as hidden.",
              },
            },
          ]
        : []),

      // Expand agendas — list view only
      ...(!isCalendar
        ? [
            {
              element: "#tour-expand-agendas",
              popover: {
                title: "Expand / Collapse Agendas",
                description:
                  "Toggle all hearing agendas open or closed at once. You can also expand or collapse individual hearings independently by clicking '▸ Show agenda' on each card.",
              },
            },
          ]
        : []),

      // Show inactive — list view, editor only
      ...(isEditor && !isCalendar
        ? [
            {
              element: "#tour-show-inactive",
              popover: {
                title: "Show Inactive Hearings",
                description:
                  "Reveals hearings that were removed from the akleg.gov schedule after a prior scrape. Inactive hearings are shown with a strikethrough and reduced opacity. Only appears when inactive hearings exist in the selected date range.",
              },
            },
          ]
        : []),

      // Always: legend
      {
        element: "#tour-legend",
        popover: {
          title: "Agenda Symbols",
          description:
            "Symbols appearing before bill numbers: * = first hearing in first committee of referral, + = teleconferenced, = = previously heard or scheduled.",
        },
      },

      // First item — differs per view
      ...(!isCalendar
        ? [
            {
              element: "#tour-first-meeting",
              popover: {
                title: "Hearing Card",
                description:
                  "Each card shows the date, time, committee, and location. Click '▸ Show agenda' to expand the bill list. Click a committee name or bill number to open it on akleg.gov. Use the Notes column to attach internal DPS notes — they persist across scrapes.",
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
