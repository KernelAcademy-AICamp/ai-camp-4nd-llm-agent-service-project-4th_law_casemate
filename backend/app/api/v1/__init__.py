from fastapi import APIRouter
from . import auth_api, evidence_api, timeline_api, search_api, case_api, search_laws, relationship_api, document_api, file_manager_api, precedent_favorites_api, agent_api

router = APIRouter()

router.include_router(auth_api.router)
router.include_router(evidence_api.router, prefix="/evidence")
router.include_router(search_api.router)
router.include_router(timeline_api.router)
router.include_router(case_api.router, prefix="/cases")
router.include_router(search_laws.router)
router.include_router(relationship_api.router, prefix="/relationships")
router.include_router(document_api.router, prefix="/documents")
router.include_router(file_manager_api.router, prefix="/file-manager")
router.include_router(precedent_favorites_api.router, prefix="/favorites/precedents")
router.include_router(agent_api.router, prefix="/agent")
