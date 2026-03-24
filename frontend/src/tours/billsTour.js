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
        element: "#tour-filter-outcomes",
        popover: {
          title: "Filter Outcomes",
          description:
            "Choose which outcome types appear in each bill's history table. Uncheck outcomes you don't need to reduce clutter.",
        },
      },
      {
        element: "#tour-toggle-descriptions",
        popover: {
          title: "Show Descriptions",
          description:
            "Toggle the full outcome description text on or off. Useful when you want more detail on a specific hearing.",
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
        element: "#tour-toggle-keywords",
        popover: {
          title: "Show Keywords",
          description:
            "Each bill on akleg.gov has official subject keywords. Toggle them on to see and search by them.",
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
        element: "#tour-first-bill",
        popover: {
          title: "Bill Card",
          description:
            "Each card shows the bill number (linked to akleg.gov), short title, current status, and introduction date. The outcomes table below tracks its progress through committees and the floor.",
        },
      },
    ],
  });
}
