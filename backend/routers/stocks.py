from fastapi import APIRouter

router = APIRouter()

@router.get("/")
def placeholder():
    return {"message": "Stocks router placeholder"}