import asyncio
import logging
logging.basicConfig(level=logging.INFO)

import httpx
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.bill import Bill
from app.services.fiscal_note_sync import _sync_bill_fiscal_notes

async def main():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Bill).where(Bill.bill_number == "SB 9", Bill.session == 34)
        )
        bill = result.scalar_one_or_none()
        if bill is None:
            print("Bill not found")
            return

        async with httpx.AsyncClient() as client:
            new_count = await _sync_bill_fiscal_notes(
                db,
                client,
                bill_id=bill.id,
                bill_number=bill.bill_number,
                bill_url_id="SB____9",
                bill_version="O",
                committee="HJUD",
            )
            await db.commit()
            print(f"Done — {new_count} new note(s) inserted.")

asyncio.run(main())
