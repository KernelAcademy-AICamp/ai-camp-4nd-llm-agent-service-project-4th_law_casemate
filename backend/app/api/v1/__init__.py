from fastapi import APIRouter
from . import auth

router = APIRouter()

# auth 라우터 포함
router.include_router(auth.router)
