import { driver } from "driver.js";
import "driver.js/dist/driver.css";

export function createMeetingsTour() {
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
      {
        element: "#tour-controls",
        popover: {
          title: "Controls",
          description:
            "Scrape the latest schedule from akleg.gov (requires login). Use 'Show inactive' to reveal meetings that were removed from the schedule after a prior scrape.",
        },
      },
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
            "Each card shows the date, time, chamber, committee, location, and full agenda. Click a committee name or bill number to open it on akleg.gov. Use the Notes column on the right to attach internal DPS notes — they persist across scrapes.",
        },
      },
    ],
  });
}
