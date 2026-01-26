from fastapi import APIRouter
from . import auth_api, evidence_api

router = APIRouter()

# auth_api 라우터 포함
router.include_router(auth_api.router)

# evidence_api 라우터 포함 (prefix: /evidence)
router.include_router(evidence_api.router, prefix="/evidence")
