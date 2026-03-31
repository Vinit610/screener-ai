from fastapi import APIRouter

router = APIRouter()

@router.get("/")
def placeholder():
    return {"message": "AI router placeholder"}