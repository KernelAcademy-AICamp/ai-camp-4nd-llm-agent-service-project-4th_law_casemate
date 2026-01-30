from fastapi import APIRouter
from . import auth_api, evidence_api, case_api

router = APIRouter()

# auth_api 라우터 포함
router.include_router(auth_api.router)

# evidence_api 라우터 포함 (prefix: /evidence)
router.include_router(evidence_api.router, prefix="/evidence")

# case_api 라우터 포함 (prefix: /cases)
router.include_router(case_api.router, prefix="/cases")
