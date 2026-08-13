from fastapi import APIRouter
from glpi_client import glpi

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/")
async def get_stats():
    return await glpi.get_stats()
