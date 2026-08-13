from fastapi import APIRouter, Query
from glpi_client import glpi

router = APIRouter(prefix="/api/soporte", tags=["soporte"])


@router.get("/closed-by-day")
async def closed_by_day(
    date_from: str = Query(...),
    date_to: str = Query(...),
):
    return await glpi.get_closed_by_day(date_from, date_to)
