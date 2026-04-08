import { driver } from "driver.js";
import "driver.js/dist/driver.css";

export function createMeetingsTour({ isEditor = false, isLoggedIn = false } = {}) {
  return driver({
    showProgress: true,
    steps: [
      {
        element: "#tour-meetings-search",
        popover: {
          title: "Search",
          description:
            "Filter meetings by committee name, bill number, description, location, or your own notes. Results update as you type.",
        },
      },
      {
        element: "#tour-date-range",
        popover: {
          title: "Date Range",
          description:
            "Choose the week or date range you want to view. Meetings load automatically when the dates change.",
        },
      },
      ...(isEditor ? [{
        element: "#tour-controls",
        popover: {
          title: "Controls",
          description:
            "Scrape the latest schedule directly from akleg.gov to pick up any changes. Requires login and a To date to be set. Use the hidden meetings toggle to show or hide meetings marked as hidden.",
        },
      }] : []),
      {
        element: "#tour-expand-agendas",
        popover: {
          title: "Expand / Collapse Agendas",
          description:
            "Toggle all meeting agendas open or closed at once. You can also expand or collapse individual meetings independently by clicking '▸ Show agenda' on each card.",
        },
      },
      ...(isEditor ? [{
        element: "#tour-show-inactive",
        popover: {
          title: "Show Inactive Meetings",
          description:
            "Reveals meetings that were removed from the akleg.gov schedule after a prior scrape. Inactive meetings are shown with a strikethrough and reduced opacity. Only appears when inactive meetings exist in the selected date range.",
        },
      }] : []),
      {
        element: "#tour-legend",
        popover: {
          title: "Agenda Symbols",
          description:
            "Symbols appearing before bill numbers: * = first hearing in first committee of referral, + = teleconferenced, = = previously heard or scheduled.",
        },
      },
      {
        element: "#tour-first-meeting",
        popover: {
          title: "Meeting Card",
          description:
            "Each card shows the date, time, committee, and location. Click '▸ Show agenda' to expand the bill list for that meeting. Click a committee name or bill number to open it on akleg.gov. Use the Notes column on the right to attach internal DPS notes — they persist across scrapes.",
        },
      },
    ],
  });
}
