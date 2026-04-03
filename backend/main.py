from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from routers import stocks, mf, ai, portfolio, auth, compare

app = FastAPI(title="screener-ai", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stocks, prefix="/api/stocks")
app.include_router(mf, prefix="/api/mf")
app.include_router(ai, prefix="/api/ai")
app.include_router(portfolio, prefix="/api/portfolio")
app.include_router(auth, prefix="/api/auth")
app.include_router(compare, prefix="/api/compare")

@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}
