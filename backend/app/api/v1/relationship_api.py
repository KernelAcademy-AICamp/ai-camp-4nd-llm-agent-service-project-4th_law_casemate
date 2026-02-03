"""
관계도 API 엔드포인트
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from tool.database import get_db
from app.services.relationship_service import RelationshipService
from app.models.relationship import CasePerson, CaseRelationship

router = APIRouter()


# Pydantic 모델 (요청 바디 검증용)
class PersonCreate(BaseModel):
    name: str
    role: str
    description: str = ""
    position_x: int = 0
    position_y: int = 0


class PersonUpdate(BaseModel):
    name: str = None
    role: str = None
    description: str = None


class RelationshipCreate(BaseModel):
    source_person_id: int
    target_person_id: int
    relationship_type: str
    label: str = None
    memo: str = ""
    is_directed: bool = True


class RelationshipUpdate(BaseModel):
    relationship_type: str = None
    label: str = None
    memo: str = None
    is_directed: bool = None


@router.get("/{case_id}")
async def get_relationships(
    case_id: str,
    db: Session = Depends(get_db)
):
    """
    관계도 조회 (자동 생성 포함)

    - case_id에 해당하는 관계도 반환
    - 관계도가 없으면 자동으로 생성 후 반환

    Returns:
        {
            "persons": [...],
            "relationships": [...]
        }
    """
    try:
        # case_id를 정수로 변환
        numeric_case_id = int(case_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid case_id format")

    print(f"\n{'='*80}")
    print(f"[Relationship API] GET 요청: case_id={numeric_case_id}")
    print(f"{'='*80}\n")

    service = RelationshipService(db=db, case_id=numeric_case_id)

    try:
        # 기존 관계도 조회 시도
        relationship_data = service.get_relationship()
        print(f"[Relationship API] 조회 성공: {len(relationship_data['persons'])}명, {len(relationship_data['relationships'])}개 관계")
        print(f"[Relationship API] 응답 데이터: {relationship_data}")
        return relationship_data
    except HTTPException as e:
        # 404 (관계도 없음)인 경우 자동 생성
        if e.status_code == 404:
            print(f"[Relationship API] 관계도 없음 - 자동 생성 시작")
            try:
                relationship_data = await service.generate_relationship()
                print(f"[Relationship API] 자동 생성 성공: {len(relationship_data['persons'])}명, {len(relationship_data['relationships'])}개 관계")
                return relationship_data
            except Exception as gen_error:
                print(f"[Relationship API] 자동 생성 실패: {str(gen_error)}")
                raise HTTPException(status_code=500, detail=f"관계도 자동 생성 실패: {str(gen_error)}")
        else:
            # 다른 에러는 그대로 전달
            raise
    except Exception as e:
        print(f"[Relationship API] 조회 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"관계도 조회 실패: {str(e)}")


@router.post("/{case_id}/generate")
async def generate_relationships(
    case_id: str,
    force: bool = False,
    db: Session = Depends(get_db)
):
    """
    관계도 생성 또는 재생성

    - force=true: 기존 관계도 삭제 후 재생성
    - force=false (기본값): 기존 관계도가 있으면 에러 반환

    Returns:
        {
            "message": "관계도 생성 완료",
            "persons": [...],
            "relationships": [...]
        }
    """
    try:
        # case_id를 정수로 변환
        numeric_case_id = int(case_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid case_id format")

    print(f"\n{'='*80}")
    print(f"[Relationship API] POST 요청: case_id={numeric_case_id}, force={force}")
    print(f"{'='*80}\n")

    service = RelationshipService(db=db, case_id=numeric_case_id)

    # force=false인 경우, 기존 관계도 존재 여부 확인
    if not force:
        try:
            existing = service.get_relationship()
            if existing and existing.get("persons"):
                print(f"[Relationship API] 기존 관계도 존재: {len(existing['persons'])}명")
                raise HTTPException(
                    status_code=409,
                    detail="이미 관계도가 존재합니다. force=true로 재생성하거나 DELETE 후 생성하세요."
                )
        except HTTPException as e:
            if e.status_code != 404:
                raise

    try:
        # 관계도 생성
        print(f"[Relationship API] 관계도 생성 시작...")
        relationship_data = await service.generate_relationship()

        print(f"[Relationship API] 생성 성공: {len(relationship_data['persons'])}명, {len(relationship_data['relationships'])}개 관계")

        return {
            "message": "관계도 생성 완료",
            "data": relationship_data
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Relationship API] 생성 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"관계도 생성 실패: {str(e)}")


@router.delete("/{case_id}")
async def delete_relationships(
    case_id: str,
    db: Session = Depends(get_db)
):
    """
    관계도 삭제

    - case_id에 해당하는 모든 인물 및 관계 삭제

    Returns:
        {
            "message": "관계도 삭제 완료"
        }
    """
    try:
        # case_id를 정수로 변환
        numeric_case_id = int(case_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid case_id format")

    print(f"\n{'='*80}")
    print(f"[Relationship API] DELETE 요청: case_id={numeric_case_id}")
    print(f"{'='*80}\n")

    service = RelationshipService(db=db, case_id=numeric_case_id)

    try:
        service.delete_relationship()
        print(f"[Relationship API] 삭제 성공")
        return {"message": "관계도 삭제 완료"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Relationship API] 삭제 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"관계도 삭제 실패: {str(e)}")


@router.patch("/{case_id}/persons/{person_id}/position")
async def update_person_position(
    case_id: str,
    person_id: str,
    position_x: int,
    position_y: int,
    db: Session = Depends(get_db)
):
    """
    인물 위치 업데이트 (프론트엔드에서 드래그 시)

    Args:
        case_id: 사건 ID
        person_id: 인물 ID
        position_x: X 좌표
        position_y: Y 좌표

    Returns:
        {
            "message": "위치 업데이트 완료"
        }
    """
    try:
        numeric_case_id = int(case_id)
        numeric_person_id = int(person_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ID format")

    from app.models.relationship import CasePerson

    person = db.query(CasePerson).filter(
        CasePerson.id == numeric_person_id,
        CasePerson.case_id == numeric_case_id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="인물을 찾을 수 없습니다")

    person.position_x = position_x
    person.position_y = position_y
    db.commit()

    return {"message": "위치 업데이트 완료"}


# ========== 인물 CRUD ========== #

@router.post("/{case_id}/persons")
async def create_person(
    case_id: str,
    person_data: PersonCreate,
    db: Session = Depends(get_db)
):
    """
    인물 추가

    Args:
        case_id: 사건 ID
        person_data: 인물 정보

    Returns:
        생성된 인물 정보
    """
    try:
        numeric_case_id = int(case_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid case_id format")

    # Case 존재 확인
    from app.models.evidence import Case
    case = db.query(Case).filter(Case.id == numeric_case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")

    # 인물 생성
    person = CasePerson(
        case_id=numeric_case_id,
        firm_id=case.law_firm_id,
        name=person_data.name,
        role=person_data.role,
        description=person_data.description,
        position_x=person_data.position_x,
        position_y=person_data.position_y
    )
    db.add(person)
    db.commit()
    db.refresh(person)

    print(f"[Relationship API] 인물 추가: {person.name} (ID: {person.id})")
    return person.to_dict()


@router.put("/{case_id}/persons/{person_id}")
async def update_person(
    case_id: str,
    person_id: str,
    person_data: PersonUpdate,
    db: Session = Depends(get_db)
):
    """
    인물 정보 수정

    Args:
        case_id: 사건 ID
        person_id: 인물 ID
        person_data: 수정할 인물 정보

    Returns:
        수정된 인물 정보
    """
    try:
        numeric_case_id = int(case_id)
        numeric_person_id = int(person_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ID format")

    person = db.query(CasePerson).filter(
        CasePerson.id == numeric_person_id,
        CasePerson.case_id == numeric_case_id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="인물을 찾을 수 없습니다")

    # 수정할 필드만 업데이트
    if person_data.name is not None:
        person.name = person_data.name
    if person_data.role is not None:
        person.role = person_data.role
    if person_data.description is not None:
        person.description = person_data.description

    db.commit()
    db.refresh(person)

    print(f"[Relationship API] 인물 수정: {person.name} (ID: {person.id})")
    return person.to_dict()


@router.delete("/{case_id}/persons/{person_id}")
async def delete_person(
    case_id: str,
    person_id: str,
    db: Session = Depends(get_db)
):
    """
    인물 삭제

    Args:
        case_id: 사건 ID
        person_id: 인물 ID

    Returns:
        삭제 완료 메시지
    """
    try:
        numeric_case_id = int(case_id)
        numeric_person_id = int(person_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ID format")

    person = db.query(CasePerson).filter(
        CasePerson.id == numeric_person_id,
        CasePerson.case_id == numeric_case_id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="인물을 찾을 수 없습니다")

    person_name = person.name

    # 관련 관계도 먼저 삭제 (FK 제약조건)
    db.query(CaseRelationship).filter(
        (CaseRelationship.source_person_id == numeric_person_id) |
        (CaseRelationship.target_person_id == numeric_person_id)
    ).delete()

    # 인물 삭제
    db.delete(person)
    db.commit()

    print(f"[Relationship API] 인물 삭제: {person_name} (ID: {numeric_person_id})")
    return {"message": f"인물 '{person_name}' 삭제 완료"}


# ========== 관계 CRUD ========== #

@router.post("/{case_id}/relationships")
async def create_relationship(
    case_id: str,
    rel_data: RelationshipCreate,
    db: Session = Depends(get_db)
):
    """
    관계 추가

    Args:
        case_id: 사건 ID
        rel_data: 관계 정보

    Returns:
        생성된 관계 정보
    """
    try:
        numeric_case_id = int(case_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid case_id format")

    # Case 존재 확인
    from app.models.evidence import Case
    case = db.query(Case).filter(Case.id == numeric_case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="사건을 찾을 수 없습니다")

    # 인물 존재 확인
    source_person = db.query(CasePerson).filter(
        CasePerson.id == rel_data.source_person_id,
        CasePerson.case_id == numeric_case_id
    ).first()
    target_person = db.query(CasePerson).filter(
        CasePerson.id == rel_data.target_person_id,
        CasePerson.case_id == numeric_case_id
    ).first()

    if not source_person or not target_person:
        raise HTTPException(status_code=404, detail="인물을 찾을 수 없습니다")

    # 관계 생성
    relationship = CaseRelationship(
        case_id=numeric_case_id,
        firm_id=case.law_firm_id,
        source_person_id=rel_data.source_person_id,
        target_person_id=rel_data.target_person_id,
        relationship_type=rel_data.relationship_type,
        label=rel_data.label or rel_data.relationship_type,
        memo=rel_data.memo,
        is_directed=rel_data.is_directed
    )
    db.add(relationship)
    db.commit()
    db.refresh(relationship)

    print(f"[Relationship API] 관계 추가: {source_person.name} -> {target_person.name} ({relationship.relationship_type})")
    return relationship.to_dict()


@router.put("/{case_id}/relationships/{relationship_id}")
async def update_relationship(
    case_id: str,
    relationship_id: str,
    rel_data: RelationshipUpdate,
    db: Session = Depends(get_db)
):
    """
    관계 정보 수정

    Args:
        case_id: 사건 ID
        relationship_id: 관계 ID
        rel_data: 수정할 관계 정보

    Returns:
        수정된 관계 정보
    """
    try:
        numeric_case_id = int(case_id)
        numeric_rel_id = int(relationship_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ID format")

    relationship = db.query(CaseRelationship).filter(
        CaseRelationship.id == numeric_rel_id,
        CaseRelationship.case_id == numeric_case_id
    ).first()

    if not relationship:
        raise HTTPException(status_code=404, detail="관계를 찾을 수 없습니다")

    # 수정할 필드만 업데이트
    if rel_data.relationship_type is not None:
        relationship.relationship_type = rel_data.relationship_type
    if rel_data.label is not None:
        relationship.label = rel_data.label
    if rel_data.memo is not None:
        relationship.memo = rel_data.memo
    if rel_data.is_directed is not None:
        relationship.is_directed = rel_data.is_directed

    db.commit()
    db.refresh(relationship)

    print(f"[Relationship API] 관계 수정: ID {numeric_rel_id}")
    return relationship.to_dict()


@router.delete("/{case_id}/relationships/{relationship_id}")
async def delete_relationship(
    case_id: str,
    relationship_id: str,
    db: Session = Depends(get_db)
):
    """
    관계 삭제

    Args:
        case_id: 사건 ID
        relationship_id: 관계 ID

    Returns:
        삭제 완료 메시지
    """
    try:
        numeric_case_id = int(case_id)
        numeric_rel_id = int(relationship_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ID format")

    relationship = db.query(CaseRelationship).filter(
        CaseRelationship.id == numeric_rel_id,
        CaseRelationship.case_id == numeric_case_id
    ).first()

    if not relationship:
        raise HTTPException(status_code=404, detail="관계를 찾을 수 없습니다")

    db.delete(relationship)
    db.commit()

    print(f"[Relationship API] 관계 삭제: ID {numeric_rel_id}")
    return {"message": "관계 삭제 완료"}
