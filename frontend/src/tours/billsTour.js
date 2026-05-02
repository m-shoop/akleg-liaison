import { driver } from "driver.js";
import "driver.js/dist/driver.css";

export function createBillsTour({ isLoggedIn = false } = {}) {
  return driver({
    showProgress: true,
    steps: [
      {
        element: "#tour-default-settings",
        popover: {
          title: "Default Page Settings",
          description:
            "Reset every filter, criterion, and display option on this page back to its starting values. Use it any time the page feels cluttered or you want a clean slate.",
        },
      },

      ...(isLoggedIn
        ? [
            {
              element: "#tour-saved-reports",
              popover: {
                title: "Saved Reports",
                description:
                  "Save the criteria you've built as a named report and re-load it with one click. Click any badge to load that report. ★ marks your default — it loads automatically when you return to this page. System reports are visible to all users; user reports are private to you. Toggle 'Include Inactive' to see archived reports.",
              },
            },
          ]
        : []),

      {
        element: "#tour-report-criteria",
        popover: {
          title: "Report Criteria",
          description:
            "Build the list of measures you want to see by stacking rows of criteria — bill number, sponsor, status, tags, fiscal-note department, and more. Combine rows with AND / OR in the Custom Logic box for complex queries (e.g. '(A AND B) OR C'). Click Run Query to apply, then Save or Save As to keep the result as a report.",
        },
      },

      {
        element: "#tour-search",
        popover: {
          title: "Search",
          description:
            "Filter the bills currently shown on this page by bill number, title, tags, outcome types, or committees. Search runs locally on the loaded bills — narrow with Report Criteria first if you don't see what you expect.",
        },
      },

      {
        element: "#tour-toggle-descriptions-keywords",
        popover: {
          title: "Show Descriptions and Keywords",
          description:
            "Toggle the full bill description text and the official subject keywords from akleg.gov on or off. Useful when you need more detail or want to scan by topic.",
        },
      },

      {
        element: "#tour-toggle-layout",
        popover: {
          title: "Layout",
          description:
            "Switch between a two-column Senate / House layout and a single scrolling list.",
        },
      },

      {
        element: "#tour-filter-outcomes-fiscal-notes",
        popover: {
          title: "Outcome & Fiscal Note Filters",
          description:
            "Choose which outcome types appear in each bill's history table and which departments' fiscal notes are shown. These are display filters — they don't change which bills are returned, only how each card is rendered.",
        },
      },

      {
        element: "#tour-export-pdf",
        popover: {
          title: "Export PDF",
          description:
            "Generate a printable PDF of the current bill list. Optionally pick a hearing date range (or use Today / Last Week / This Week / Next Week) to include the matching committee schedule at the top. Leave dates blank to export bills only.",
        },
      },

      {
        element: "#tour-report-header",
        popover: {
          title: "Report Header",
          description:
            "Customize the cover section of the PDF — title, date range, updated date, and call-in instructions. Check 'Include in PDF' to add it to the export. Your text and dates are saved automatically.",
        },
      },

      {
        element: "#tour-first-bill",
        popover: {
          title: "Bill Card",
          description:
            "Each card shows the bill number (linked to akleg.gov), short title, sponsor(s), current status, and introduction date. The outcomes table tracks committee and floor progress; any active fiscal notes appear below it. Upcoming hearings for the bill, when known, are shown at the top of the card.",
        },
      },
    ],
  });
}
