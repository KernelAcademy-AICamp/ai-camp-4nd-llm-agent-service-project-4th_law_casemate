from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
import logging

from tool.database import get_db
from tool.security import get_current_user
from app.models.user import User
from app.models.precedent_favorite import PrecedentFavorite
from app.services.precedent_search_service import PrecedentSearchService

logger = logging.getLogger(__name__)

router = APIRouter()

# 판례 검색 서비스 (Qdrant에서 판례 정보 조회용)
search_service = PrecedentSearchService()


@router.post("/{case_number}")
async def add_favorite(
    case_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    판례 즐겨찾기 추가

    - case_number: 판례 사건번호
    - 이미 즐겨찾기한 경우 무시
    """
    logger.debug(f"즐겨찾기 추가: case_number={case_number}, user_id={current_user.id}")

    try:
        # 이미 즐겨찾기 되어있는지 확인
        existing = db.query(PrecedentFavorite).filter(
            PrecedentFavorite.user_id == current_user.id,
            PrecedentFavorite.case_number == case_number
        ).first()

        if existing:
            return {
                "message": "이미 즐겨찾기에 추가되어 있습니다",
                "favorite_id": existing.id,
                "case_number": case_number
            }

        # 새 즐겨찾기 추가
        new_favorite = PrecedentFavorite(
            user_id=current_user.id,
            case_number=case_number
        )
        db.add(new_favorite)
        db.commit()
        db.refresh(new_favorite)

        logger.info(f"즐겨찾기 추가 완료: favorite_id={new_favorite.id}")

        return {
            "message": "즐겨찾기 추가 완료",
            "favorite_id": new_favorite.id,
            "case_number": case_number
        }

    except Exception as e:
        db.rollback()
        logger.error(f"즐겨찾기 추가 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="즐겨찾기 추가 중 오류가 발생했습니다")


@router.delete("/{case_number}")
async def remove_favorite(
    case_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    판례 즐겨찾기 제거

    - case_number: 판례 사건번호
    """
    logger.debug(f"즐겨찾기 제거: case_number={case_number}, user_id={current_user.id}")

    try:
        # 즐겨찾기 조회
        favorite = db.query(PrecedentFavorite).filter(
            PrecedentFavorite.user_id == current_user.id,
            PrecedentFavorite.case_number == case_number
        ).first()

        if not favorite:
            raise HTTPException(status_code=404, detail="즐겨찾기를 찾을 수 없습니다")

        # 삭제
        db.delete(favorite)
        db.commit()

        logger.info(f"즐겨찾기 제거 완료: case_number={case_number}")

        return {
            "message": "즐겨찾기 제거 완료",
            "case_number": case_number
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"즐겨찾기 제거 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="즐겨찾기 제거 중 오류가 발생했습니다")


@router.get("")
async def get_favorites(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    즐겨찾기 목록 조회

    - 현재 사용자의 즐겨찾기 판례 목록 반환
    - Qdrant에서 판례 상세 정보 조회하여 함께 반환
    """
    logger.debug(f"즐겨찾기 목록 조회: user_id={current_user.id}")

    try:
        # 즐겨찾기 목록 조회 (최신순)
        favorites = db.query(PrecedentFavorite).filter(
            PrecedentFavorite.user_id == current_user.id
        ).order_by(PrecedentFavorite.created_at.desc()).all()

        logger.debug(f"즐겨찾기 {len(favorites)}건 조회")

        # 각 판례의 상세 정보 조회 (Qdrant에서)
        favorite_list = []
        for fav in favorites:
            # Qdrant에서 판례 정보 조회
            case_detail = search_service.get_case_detail(fav.case_number)

            if case_detail:
                favorite_list.append({
                    "favorite_id": fav.id,
                    "case_number": fav.case_number,
                    "case_name": case_detail.get("case_name", ""),
                    "court_name": case_detail.get("court_name", ""),
                    "judgment_date": case_detail.get("judgment_date", ""),
                    "created_at": fav.created_at.isoformat() if fav.created_at else None
                })
            else:
                # Qdrant에 없는 경우 기본 정보만
                favorite_list.append({
                    "favorite_id": fav.id,
                    "case_number": fav.case_number,
                    "case_name": "",
                    "court_name": "",
                    "judgment_date": "",
                    "created_at": fav.created_at.isoformat() if fav.created_at else None
                })

        return {
            "total": len(favorite_list),
            "favorites": favorite_list
        }

    except Exception as e:
        logger.error(f"즐겨찾기 목록 조회 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="즐겨찾기 목록 조회 중 오류가 발생했습니다")


@router.get("/{case_number}/status")
async def get_favorite_status(
    case_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    즐겨찾기 상태 확인

    - case_number: 판례 사건번호
    - 해당 판례가 즐겨찾기 되어있는지 확인
    """
    try:
        favorite = db.query(PrecedentFavorite).filter(
            PrecedentFavorite.user_id == current_user.id,
            PrecedentFavorite.case_number == case_number
        ).first()

        return {
            "case_number": case_number,
            "is_favorite": favorite is not None,
            "favorite_id": favorite.id if favorite else None
        }

    except Exception as e:
        logger.error(f"즐겨찾기 상태 확인 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="즐겨찾기 상태 확인 중 오류가 발생했습니다")


@router.post("/{case_number}/toggle")
async def toggle_favorite(
    case_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    즐겨찾기 토글 (있으면 제거, 없으면 추가)

    - case_number: 판례 사건번호
    - 프론트엔드에서 편하게 사용할 수 있는 토글 API
    """
    logger.debug(f"즐겨찾기 토글: case_number={case_number}, user_id={current_user.id}")

    try:
        # 기존 즐겨찾기 확인
        existing = db.query(PrecedentFavorite).filter(
            PrecedentFavorite.user_id == current_user.id,
            PrecedentFavorite.case_number == case_number
        ).first()

        if existing:
            # 있으면 제거
            db.delete(existing)
            db.commit()
            logger.info(f"즐겨찾기 제거됨: case_number={case_number}")
            return {
                "message": "즐겨찾기 제거 완료",
                "case_number": case_number,
                "is_favorite": False
            }
        else:
            # 없으면 추가
            new_favorite = PrecedentFavorite(
                user_id=current_user.id,
                case_number=case_number
            )
            db.add(new_favorite)
            db.commit()
            db.refresh(new_favorite)
            logger.info(f"즐겨찾기 추가됨: case_number={case_number}")
            return {
                "message": "즐겨찾기 추가 완료",
                "case_number": case_number,
                "is_favorite": True,
                "favorite_id": new_favorite.id
            }

    except Exception as e:
        db.rollback()
        logger.error(f"즐겨찾기 처리 중 오류: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="즐겨찾기 처리 중 오류가 발생했습니다")
