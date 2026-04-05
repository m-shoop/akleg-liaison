import asyncio
import logging
logging.basicConfig(level=logging.INFO)

import httpx
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.bill import Bill
from app.services.fiscal_note_sync import _fetch_bill_note_links, _sync_bill_fiscal_notes

async def main():
    async with AsyncSessionLocal() as db:
        async with httpx.AsyncClient() as client:
            # Change this to any bill_number in your DB
            result = await db.execute(
                select(Bill).where(Bill.bill_number == "SB 20", Bill.session == 34)
            )
            bill = result.scalar_one_or_none()
            if bill is None:
                print("Bill not found")
                return

            await _sync_bill_fiscal_notes(
                db, client, bill,
                bill_url_id="SB___20",
                bill_version="I",
                committee="HEDC",
            )
            await db.commit()
            print("Done")

asyncio.run(main())
