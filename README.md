# Leg Up — Alaska Legislature Liaison Tool for DPS

**Leg Up** is a web application built for Alaska Department of Public Safety liaisons to monitor and report on the Alaska State Legislature. It tracks bills of interest, scrapes and stores weekly committee meeting schedules, and produces formatted PDF reports.

---

## Features

- **Bill tracking** — search and track bills across the 34th Alaska Legislature session; tag bills and filter by outcome type
- **Outcome analysis** — bill events are scraped from akleg.gov and analyzed by Mistral AI to extract structured hearing outcomes (passed, failed, referred to committee, etc.)
- **Meeting schedule** — weekly committee meetings are scraped from akleg.gov and stored with full agenda items, teleconference flags, and prefix symbols
- **DPS notes** — liaisons can attach internal notes to each meeting; notes persist across scrapes
- **Inactive meeting tracking** — when a meeting is rescheduled, the old record is deactivated rather than deleted; liaisons are warned when a deactivated version of a meeting has notes attached to it
- **PDF export** — generates a formatted report with the week's meeting schedule followed by all tracked bills and their outcomes
- **Daily background sync** — the backend automatically scrapes bill data from akleg.gov at 4 AM Alaska time and on startup
- **Authentication** — JWT-based login; write operations (notes, scraping, tagging) require a logged-in user

---

## Screenshots

**Bills page**
![Bills page](screenshots/Screenshot%20Bills.png)

**Meetings page**
![Meetings page](screenshots/Screenshot%20-%20Meetings.png)

**PDF export — bills only**
![PDF export without meetings](screenshots/Screenshot%20Bills%20Report.png)

**PDF export — meetings + bills**
![PDF export with meetings](screenshots/Screenshot%20Bills%20Report%20with%20Meetings.png)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy (async), asyncpg |
| Database | PostgreSQL |
| Migrations | Alembic |
| Scraping | Playwright, BeautifulSoup4 |
| AI analysis | Mistral AI |
| Frontend | React 18, Vite, CSS Modules |
| PDF export | react-to-print |

---

## Project Structure

```
akleg-liaison/
├── backend/
│   ├── app/
│   │   ├── models/          # SQLAlchemy ORM models
│   │   ├── repositories/    # Database access layer
│   │   ├── routers/         # FastAPI route handlers
│   │   ├── schemas/         # Pydantic request/response schemas
│   │   └── services/        # Business logic (scraping, scheduling, AI)
│   ├── alembic/             # Database migrations
│   ├── .env.example
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── api/             # Fetch wrappers for each backend resource
    │   ├── components/      # Reusable UI components
    │   ├── context/         # Auth context
    │   ├── pages/           # Home (bills), Meetings, QueryBill, Login
    │   └── utils/
    └── index.html
```

---

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 18+
- PostgreSQL
- A [Mistral AI](https://mistral.ai) API key

### Backend Setup

```bash
cd backend

# Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Install Playwright browser
playwright install chromium

# Configure environment
cp .env.example .env
# Edit .env with your database URL, Mistral key, and secret key
# Generate a secret key with: python -c "import secrets; print(secrets.token_hex(32))"

# Run database migrations
alembic upgrade head

# Start the backend
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`. Interactive docs are at `http://localhost:8000/docs`.

### Frontend Setup

```bash
cd frontend

npm install
npm run dev
```

The app will be available at `http://localhost:5173`. The Vite dev server proxies all `/api` requests to the backend.

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in the values:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (`postgresql+asyncpg://...`) |
| `MISTRAL_API_KEY` | API key from [console.mistral.ai](https://console.mistral.ai) |
| `SECRET_KEY` | Random secret for JWT signing — generate with `secrets.token_hex(32)` |
| `REGISTRATION_KEY` | Shared secret required to create new user accounts |

---

## Usage

### Creating a user account

Registration requires a `REGISTRATION_KEY` — set this in your `.env` file and share it out-of-band with anyone who needs an account.

```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "your-username", "password": "your-password", "registration_key": "your-key"}'
```

Passwords are stored as bcrypt hashes. Once logged in, users can scrape meetings, manage notes, tag bills, and export reports.

### Scraping meetings

On the **Meetings** page, set a date range and click **Scrape from akleg.gov**. The scraper fetches the Alaska Legislature committee schedule using Playwright and stores all meetings and agenda items. Subsequent scrapes for the same date range will deactivate any meetings that have been removed from the schedule.

### Exporting a report

On the **Bills** page, optionally set a meeting date range in the Export PDF controls. If a range is set, the PDF will open with the meeting schedule followed by all tracked bills. If no range is set, only the bill list is exported.
