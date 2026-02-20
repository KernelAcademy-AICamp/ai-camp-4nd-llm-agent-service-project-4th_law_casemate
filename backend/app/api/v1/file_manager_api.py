"""
파일 관리 페이지 통합 초기화 API
카테고리 + 증거파일 + 사건폴더 + 문서 목록을 한 번에 반환
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from tool.database import get_db
from tool.security import get_current_user
from app.models.user import User
from app.models import evidence as models
from app.models.case_document import CaseDocument

router = APIRouter(tags=["FileManager"])


@router.get("/init")
async def file_manager_init(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    파일 관리 페이지 초기 데이터 통합 조회
    기존 4번 API 호출 → 1번으로 통합
    """
    firm_id = current_user.firm_id
    user_id = current_user.id

    # 1. 증거 카테고리
    categories_raw = (
        db.query(models.EvidenceCategory)
        .filter(models.EvidenceCategory.firm_id == firm_id)
        .order_by(models.EvidenceCategory.order_index.asc())
        .all()
    )
    categories = [
        {
            "category_id": cat.id,
            "name": cat.name,
            "parent_id": cat.parent_id,
            "order_index": cat.order_index,
        }
        for cat in categories_raw
    ]

    # 2. 증거 파일 (LEFT JOIN으로 연결 사건 ID 포함)
    files_raw = (
        db.query(
            models.Evidence,
            func.array_agg(models.CaseEvidenceMapping.case_id).label("linked_case_ids"),
        )
        .outerjoin(
            models.CaseEvidenceMapping,
            models.Evidence.id == models.CaseEvidenceMapping.evidence_id,
        )
        .filter(models.Evidence.law_firm_id == firm_id)
        .group_by(models.Evidence.id)
        .order_by(models.Evidence.created_at.desc())
        .all()
    )
    files = [
        {
            "evidence_id": ev.id,
            "file_name": ev.file_name,
            "file_type": ev.file_type,
            "file_size": ev.size if ev.size else 0,
            "starred": ev.starred if ev.starred is not None else False,
            "linked_case_ids": [cid for cid in (linked or []) if cid is not None],
            "category_id": ev.category_id,
            "created_at": ev.created_at.isoformat() if ev.created_at else None,
        }
        for ev, linked in files_raw
    ]

    # 3. 사건 폴더 (사건 목록)
    cases_raw = (
        db.query(models.Case)
        .filter(models.Case.law_firm_id == firm_id)
        .order_by(models.Case.created_at.desc())
        .all()
    )
    case_folders = [
        {"id": c.id, "title": c.title}
        for c in cases_raw
    ]

    # 4. 문서 목록 (비공개 문서는 작성자만, 레거시 NULL law_firm_id 포함)
    docs_raw = (
        db.query(CaseDocument)
        .filter(or_(
            CaseDocument.law_firm_id == firm_id,
            CaseDocument.law_firm_id.is_(None),
        ))
        .order_by(CaseDocument.updated_at.desc())
        .all()
    )
    documents = [
        {
            "id": doc.id,
            "case_id": doc.case_id,
            "title": doc.title,
            "document_type": doc.document_type,
            "access_level": doc.access_level or "firm_readonly",
            "created_by": doc.created_by,
            "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
        }
        for doc in docs_raw
        if (doc.access_level or "firm_readonly") != "private" or doc.created_by == user_id
    ]

    return {
        "categories": categories,
        "files": files,
        "case_folders": case_folders,
        "documents": documents,
    }
