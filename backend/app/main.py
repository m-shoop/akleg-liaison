import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.database import Base, engine
from app.limiter import limiter
from app.routers import auth, bills, jobs, meetings, tags, workflows
from app.services.scheduler import hearing_scheduler_loop, scheduler_loop

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background schedulers
    bill_task = asyncio.create_task(scheduler_loop())
    hearing_task = asyncio.create_task(hearing_scheduler_loop())
    yield
    bill_task.cancel()
    hearing_task.cancel()
    for task in (bill_task, hearing_task):
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Leg Up",
    description="Track Alaska Legislature bills",
    version="0.1.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],  # React dev servers
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(bills.router)
app.include_router(tags.router)
app.include_router(meetings.router)
app.include_router(jobs.router)
app.include_router(workflows.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
