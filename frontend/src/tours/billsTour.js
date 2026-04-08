import { driver } from "driver.js";
import "driver.js/dist/driver.css";

export function createBillsTour() {
  return driver({
    showProgress: true,
    steps: [
      {
        element: "#tour-search",
        popover: {
          title: "Search",
          description:
            "Search across bill numbers, titles, tags, outcome types, and committees. Results update as you type.",
        },
      },
      {
        element: "#tour-filter-outcomes-fiscal-notes",
        popover: {
          title: "Filter Outcomes and Fiscal Notes",
          description:
            "Choose which outcome types appear in each bill's history table. Uncheck outcomes you don't need to reduce clutter. And for fiscal notes, select which departments' notes are shown.",
        },
      },
      {
        element: "#tour-toggle-descriptions-keywords",
        popover: {
          title: "Show Descriptions and Keywords",
          description:
            "Toggle the full outcome description text on or off. Useful when you want more detail on a specific hearing. And each bill on akleg.gov has official subject keywords. Toggle them on to see and search by them.",
        },
      },
      {
        element: "#tour-toggle-untracked",
        popover: {
          title: "Show Untracked Bills",
          description:
            "The daily sync picks up every bill on akleg.gov, but only tracked bills appear by default. Toggle this to see all bills.",
        },
      },
      {
        element: "#tour-toggle-layout",
        popover: {
          title: "Layout",
          description:
            "Switch between a two-column Senate/House layout and a single scrolling list.",
        },
      },
      {
        element: "#tour-export-pdf",
        popover: {
          title: "Export PDF",
          description:
            "Optionally enter a meeting date range to include the week's committee schedule at the top of the report. Leave blank to export the bill list only.",
        },
      },
      {
        element: "#tour-toggle-filter-bills-with-hearings",
        popover: {
          title: "Toggle Bill Filtering Based on Hearings",
          description:
            "Optionally toggle on to only show bills with a hearing on the dates entered above. Leave off to show all tracked bills.",        },
      },
      {
        element: "#tour-report-header",
        popover: {
          title: "Report Header",
          description:
            "Click '▸ Report header' to expand a customizable cover section for the PDF — includes the committee hearing title, date range, updated date, and call-in instructions. Check 'Include in PDF' to include it in the export. Your text and dates are saved automatically.",
        },
      },
      {
        element: "#tour-first-bill",
        popover: {
          title: "Bill Card",
          description:
            "Each card shows the bill number (linked to akleg.gov), short title, sponsor(s), current status, and introduction date. The outcomes table below tracks its progress through committees and the floor. A table of any active fiscal notes follows.",
        },
      },
    ],
  });
}
