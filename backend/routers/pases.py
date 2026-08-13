from fastapi import APIRouter, Query
from glpi_client import glpi

router = APIRouter(prefix="/api/pases", tags=["pases"])


@router.get("")
async def get_pases(
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    return await glpi.get_pases_produccion(limit=limit, offset=offset)
