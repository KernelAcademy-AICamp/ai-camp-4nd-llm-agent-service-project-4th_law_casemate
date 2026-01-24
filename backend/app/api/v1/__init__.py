from fastapi import APIRouter
from . import auth_api

router = APIRouter()

# auth_api 라우터 포함
router.include_router(auth_api.router)
