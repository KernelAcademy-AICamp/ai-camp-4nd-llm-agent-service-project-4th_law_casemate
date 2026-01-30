from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime
from pydantic import BaseModel
import os
import uuid
import time
from app.services.evidence_processor import EvidenceProcessor

from tool.database import get_db
from tool.security import get_current_user
from app.models.user import User
from app.models import evidence as models

# 요청 스키마
class CategoryCreateRequest(BaseModel):
    name: str
    parent_id: int | None = None
    order_index: int | None = 0

# 환경변수 로드
load_dotenv()

# Supabase 설정 (Service Role Key 사용 - RLS 우회)
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 .env 파일에 설정되지 않았습니다")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

router = APIRouter()

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    case_id: int | None = None,  # 선택적: 사건 ID
    category_id: int | None = None,  # 선택적: 카테고리 ID
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)  # 로그인 확인
):
    """
    증거파일 업로드

    - file: 업로드할 파일 (한글 파일명 지원)
    - case_id: (선택) 사건 ID
    - category_id: (선택) 카테고리 ID
    - 인증된 사용자만 업로드 가능

    **응답:**
    - evidence_id: 생성된 증거 ID
    - file_name: 원본 파일명 (한글 포함)
    - url: Signed URL (60초 유효)
    """
    print("=" * 50)
    print(f"🎉 Upload Evidence endpoint called!")
    print(f"📁 파일명: {file.filename}")
    print(f"📋 사건 ID: {case_id if case_id else '미연결'}")
    print(f"📂 카테고리 ID: {category_id if category_id else '미분류'}")
    print("=" * 50)

    # 1. 파일 이름 중복 방지를 위한 고유 식별자 생성
    file_extension = file.filename.split(".")[-1] if "." in file.filename else "bin"
    unique_filename = f"{uuid.uuid4()}.{file_extension}"

    # 2. 폴더 구조: 회사아이디/YYYYMMDD/파일명 (버킷 이름은 from_()에서 지정)
    today_date = datetime.now().strftime("%Y%m%d")  # YYYYMMDD 형식
    firm_id = current_user.firm_id if current_user.firm_id else "unassigned"
    file_path = f"{firm_id}/{today_date}/{unique_filename}"

    try:
        # 3. Supabase Storage 업로드 (폴더 자동 생성)
        file_content = await file.read()
        upload_response = supabase.storage.from_("Evidences").upload(
            path=file_path,
            file=file_content,
            file_options={"content-type": file.content_type}
        )

        print(f"📤 Upload response: {upload_response}")

        # 업로드 응답 검증
        if hasattr(upload_response, 'error') and upload_response.error:
            raise HTTPException(status_code=500, detail=f"Supabase 업로드 실패: {upload_response.error}")

        # 4. Signed URL 생성 (60초 유효)
        signed_url_response = supabase.storage.from_("Evidences").create_signed_url(file_path, 60)
        signed_url = signed_url_response.get('signedURL') if signed_url_response else ""
        print(f"🔗 Signed URL: {signed_url}")

        # 5. DB 저장
        new_evidence = models.Evidence(
            uploader_id=current_user.id,
            law_firm_id=current_user.firm_id,  # 사용자의 사무실 ID 저장
            file_name=file.filename,  # 원본 파일명 저장 (한글 지원)
            file_url=signed_url,  # Signed URL 저장
            file_path=file_path,  # Storage 내부 경로 저장 (재생성용)
            file_type=file.content_type,
            size=len(file_content),  # 파일 크기 (바이트)
            case_id=case_id,  # 사건 ID (선택적)
            category_id=category_id  # 카테고리 ID (선택적)
        )
        db.add(new_evidence)
        db.commit()
        db.refresh(new_evidence)

        # 6. 증거 파일 처리 (AUDIO, PDF, IMAGE)
        try:
            print(f"🔍 파일 처리 시작: {file.filename}")

            # 파일 내용으로 새 UploadFile 객체 생성
            from io import BytesIO
            from fastapi import UploadFile

            file_for_processing = BytesIO(file_content)
            upload_file = UploadFile(
                file=file_for_processing,
                filename=file.filename,
                headers={"content-type": file.content_type}
            )

            # EvidenceProcessor로 파일 처리
            processor = EvidenceProcessor()
            result = await processor.process(upload_file, detail="high")

            # 처리 결과 로그 출력
            if result.get("success"):
                print(f"✅ 파일 처리 완료 (evidence_id={new_evidence.id})")
                print(f"📋 타입: {result.get('type')}, 방법: {result.get('method')}")
                print(f"💰 비용 추정: {result.get('cost_estimate')}")

                if result.get("text"):
                    text = result["text"]
                    print(f"📝 추출된 텍스트: {text[:200]}..." if len(text) > 200 else f"📝 추출된 텍스트: {text}")
                    print(f"📊 총 글자 수: {result.get('char_count')}자")

                    # OCR/STT 결과를 DB에 저장
                    try:
                        # 1. 텍스트 저장
                        new_evidence.content = text

                        # 2. 문서 유형 분류 (Vision API 사용 시에만)
                        # IMAGE + Vision API 사용 시 → doc_type 포함
                        # 그 외 (AUDIO, PDF, 로컬 OCR) → doc_type NULL
                        method = result.get("method", "")
                        if result.get("type") == "IMAGE" and method.startswith("openai-vision"):
                            # Vision API가 doc_type을 이미 반환한 경우
                            doc_type = result.get("doc_type", None)
                            new_evidence.doc_type = doc_type
                            print(f"📋 Vision API에서 문서 유형 추출: {doc_type}")
                        else:
                            # 로컬 OCR, PDF, AUDIO → doc_type 비움
                            new_evidence.doc_type = None
                            print(f"📋 문서 유형: 미분류 (Vision API 미사용)")

                        # 3. DB 업데이트
                        db.commit()
                        doc_type_str = new_evidence.doc_type if new_evidence.doc_type else "미분류"
                        print(f"💾 OCR 결과 저장 완료: content={len(text)}자, doc_type={doc_type_str}")

                    except Exception as classify_error:
                        print(f"⚠️ 문서 분류/저장 실패: {str(classify_error)}")
                        # 분류 실패해도 텍스트는 저장
                        new_evidence.content = text
                        new_evidence.doc_type = None
                        db.commit()

                # PDF 세부 정보
                if result.get("type") == "PDF":
                    print(f"📄 총 페이지: {result.get('total_pages')}")
                    if result.get("text_pages"):
                        print(f"📝 텍스트 페이지: {result.get('text_pages')}")
                    if result.get("image_pages"):
                        print(f"🖼️ 이미지 페이지: {result.get('image_pages')}")
            else:
                print(f"⚠️ 파일 처리 실패 (evidence_id={new_evidence.id})")
                print(f"❌ 에러: {result.get('error')}")

        except Exception as processing_error:
            print(f"⚠️ 파일 처리 실패 (업로드는 성공): {str(processing_error)}")
            # 처리 실패해도 업로드는 성공으로 처리

        return {
            "message": "업로드 성공",
            "evidence_id": new_evidence.id,
            "file_name": file.filename,
            "url": signed_url,
            "case_id": new_evidence.case_id,
            "category_id": new_evidence.category_id
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"업로드 실패: {str(e)}")

@router.delete("/delete/{evidence_id}")
async def delete_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거 파일 삭제

    - evidence_id: 삭제할 증거 ID
    - DB에서 증거 레코드 삭제
    - case_evidence_mappings에서 관련 매핑 삭제
    - Supabase Storage에서 실제 파일 삭제
    """
    print(f"🗑️ 증거 삭제 요청: evidence_id={evidence_id}, user_id={current_user.id}, firm_id={current_user.firm_id}")

    try:
        # 1. 증거 조회
        evidence = db.query(models.Evidence).filter(
            models.Evidence.id == evidence_id
        ).first()

        if not evidence:
            raise HTTPException(status_code=404, detail="증거를 찾을 수 없습니다")

        # 2. 소유권 검증
        if evidence.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 증거를 삭제할 권한이 없습니다")

        # 3. Storage에서 파일 삭제
        if evidence.file_path:
            try:
                supabase.storage.from_("Evidences").remove([evidence.file_path])
                print(f"📤 Storage에서 파일 삭제: {evidence.file_path}")
            except Exception as storage_error:
                print(f"⚠️ Storage 파일 삭제 실패 (계속 진행): {str(storage_error)}")

        # 4. case_evidence_mappings에서 관련 매핑 삭제
        db.query(models.CaseEvidenceMapping).filter(
            models.CaseEvidenceMapping.evidence_id == evidence_id
        ).delete()

        # 5. 증거 레코드 삭제
        db.delete(evidence)
        db.commit()

        print(f"✅ 증거 삭제 완료: evidence_id={evidence_id}")

        return {"message": "증거 삭제 완료", "evidence_id": evidence_id}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ 증거 삭제 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"증거 삭제 실패: {str(e)}")

@router.delete("/categories/delete/{category_id}")
async def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거 카테고리 삭제

    - category_id: 삭제할 카테고리 ID
    - 해당 카테고리가 현재 사용자의 firm_id에 속하는지 검증 후 삭제
    """
    print(f"🗑️ 카테고리 삭제 요청: category_id={category_id}, user_id={current_user.id}, firm_id={current_user.firm_id}")

    try:
        # 1. 카테고리 조회
        category = db.query(models.EvidenceCategory).filter(
            models.EvidenceCategory.id == category_id
        ).first()

        if not category:
            raise HTTPException(status_code=404, detail="카테고리를 찾을 수 없습니다")

        # 2. 소유권 검증
        if category.firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 카테고리를 삭제할 권한이 없습니다")

        # 3. 카테고리 삭제
        db.delete(category)
        db.commit()

        print(f"✅ 카테고리 삭제 완료: category_id={category_id}")

        return {"message": "카테고리 삭제 완료"}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ 카테고리 삭제 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"카테고리 삭제 실패: {str(e)}")

@router.post("/categories")
async def create_category(
    request: CategoryCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거 카테고리 생성

    - name: 카테고리명 (필수)
    - parent_id: (선택) 부모 카테고리 ID - 하위 카테고리 생성 시
    - order_index: (선택) 정렬 순서 (기본값: 0)
    - firm_id는 현재 사용자의 firm_id로 자동 설정
    """
    print(f"📂 카테고리 생성: name={request.name}, parent_id={request.parent_id}, order_index={request.order_index}")

    try:
        # parent_id가 제공된 경우, 해당 카테고리가 같은 firm에 속하는지 검증
        if request.parent_id is not None:
            parent_category = db.query(models.EvidenceCategory).filter(
                models.EvidenceCategory.id == request.parent_id
            ).first()

            if not parent_category:
                raise HTTPException(status_code=404, detail="부모 카테고리를 찾을 수 없습니다")

            if parent_category.firm_id != current_user.firm_id:
                raise HTTPException(status_code=403, detail="부모 카테고리에 접근할 권한이 없습니다")

        # 새 카테고리 생성
        new_category = models.EvidenceCategory(
            firm_id=current_user.firm_id,
            parent_id=request.parent_id,
            name=request.name,
            order_index=request.order_index if request.order_index is not None else 0
        )

        db.add(new_category)
        db.commit()
        db.refresh(new_category)

        print(f"✅ 카테고리 생성 완료: category_id={new_category.id}")

        return {
            "message": "카테고리 생성 완료",
            "category_id": new_category.id,
            "name": new_category.name,
            "firm_id": new_category.firm_id,
            "parent_id": new_category.parent_id,
            "order_index": new_category.order_index
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ 카테고리 생성 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"카테고리 생성 실패: {str(e)}")

@router.get("/categories")
async def get_category_list(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거 카테고리 목록 조회

    - 현재 사용자의 firm_id에 해당하는 카테고리만 반환
    - 계층 구조 포함 (parent_id)
    - order_index 기준 정렬
    """
    print(f"📂 카테고리 목록 조회: user_id={current_user.id}, firm_id={current_user.firm_id}")

    try:
        # 쿼리: 현재 사용자의 firm_id로 필터링, order_index로 정렬
        categories = db.query(models.EvidenceCategory).filter(
            models.EvidenceCategory.firm_id == current_user.firm_id
        ).order_by(
            models.EvidenceCategory.order_index.asc()
        ).all()

        print(f"✅ 조회된 카테고리 수: {len(categories)}")

        # 응답 데이터 구성
        category_list = []
        for category in categories:
            category_list.append({
                "category_id": category.id,
                "name": category.name,
                "firm_id": category.firm_id,
                "parent_id": category.parent_id,
                "order_index": category.order_index
            })

        return {
            "total": len(category_list),
            "categories": category_list
        }

    except Exception as e:
        print(f"❌ 카테고리 목록 조회 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"카테고리 목록 조회 실패: {str(e)}")

@router.get("/list")
async def get_evidence_list(
    case_id: int | None = None,  # 선택적: 특정 사건의 파일만 조회
    category_id: int | None = None,  # 선택적: 특정 카테고리의 파일만 조회
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거파일 목록 조회

    - 현재 사용자의 law_firm_id에 해당하는 증거 파일만 반환
    - case_id: (선택) 특정 사건의 파일만 필터링
    - category_id: (선택) 특정 카테고리의 파일만 필터링
    - 최신순 정렬 (created_at DESC)
    """
    # 시작 시간 측정
    start_time = time.time()
    start_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

    print(f"\n{'='*80}")
    print(f"📋 [증거 목록 조회] 시작 - {start_datetime}")
    print(f"📋 파라미터: user_id={current_user.id}, firm_id={current_user.firm_id}, case_id={case_id}, category_id={category_id}")
    print(f"{'='*80}")

    try:
        # DB 쿼리 시작 (JOIN 사용으로 1번의 쿼리로 통합)
        query_start = time.time()
        print(f"⏱️  [DB 쿼리 + JOIN] 시작 - {datetime.now().strftime('%H:%M:%S.%f')[:-3]}")

        # LEFT JOIN + GROUP BY로 증거와 연결된 사건 ID를 한 번에 조회
        query = db.query(
            models.Evidence,
            func.array_agg(models.CaseEvidenceMapping.case_id).label('linked_case_ids')
        ).outerjoin(
            models.CaseEvidenceMapping,
            models.Evidence.id == models.CaseEvidenceMapping.evidence_id
        ).filter(
            models.Evidence.law_firm_id == current_user.firm_id
        )

        # case_id가 제공되면 HAVING 절로 필터링
        if case_id is not None:
            # 특정 case_id가 연결된 증거만 조회
            query = query.filter(models.CaseEvidenceMapping.case_id == case_id)

        # category_id가 제공되면 추가 필터링
        if category_id is not None:
            query = query.filter(models.Evidence.category_id == category_id)

        # GROUP BY로 증거별로 집계
        query = query.group_by(models.Evidence.id)

        # 최신순 정렬
        results = query.order_by(models.Evidence.created_at.desc()).all()

        query_end = time.time()
        query_duration = (query_end - query_start) * 1000  # 밀리초로 변환
        print(f"✅ [DB 쿼리 + JOIN] 완료 - {datetime.now().strftime('%H:%M:%S.%f')[:-3]} (소요: {query_duration:.2f}ms)")
        print(f"📊 조회된 증거 파일 수: {len(results)}")
        print(f"🚀 성능 개선: 1번의 쿼리로 모든 데이터 조회 (기존 N+1 문제 해결)")

        # 응답 데이터 구성 시작
        mapping_start = time.time()
        print(f"⏱️  [응답 데이터 구성] 시작 - {datetime.now().strftime('%H:%M:%S.%f')[:-3]}")

        evidence_list = []
        for idx, (evidence, linked_case_ids) in enumerate(results):
            # None 값 필터링 (연결된 사건이 없는 경우)
            case_ids = [cid for cid in (linked_case_ids or []) if cid is not None]

            if idx < 5:
                print(f"   └─ 증거 #{idx+1} (id={evidence.id}): 연결된 사건 {len(case_ids)}개")

            evidence_list.append({
                "evidence_id": evidence.id,
                "file_name": evidence.file_name,
                "file_type": evidence.file_type,
                "file_size": evidence.size if evidence.size else 0,
                "file_path": evidence.file_path,
                "starred": evidence.starred if evidence.starred is not None else False,
                "linked_case_ids": case_ids,  # 연결된 사건 ID 배열
                "category_id": evidence.category_id,
                "created_at": evidence.created_at.isoformat() if evidence.created_at else None,
                "uploader_id": evidence.uploader_id
            })

        mapping_end = time.time()
        mapping_duration = (mapping_end - mapping_start) * 1000
        print(f"✅ [응답 데이터 구성] 완료 - {datetime.now().strftime('%H:%M:%S.%f')[:-3]} (소요: {mapping_duration:.2f}ms)")

        # 전체 완료
        end_time = time.time()
        total_duration = (end_time - start_time) * 1000
        end_datetime = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

        print(f"\n{'='*80}")
        print(f"🎉 [증거 목록 조회] 완료 - {end_datetime}")
        print(f"📊 총 소요 시간: {total_duration:.2f}ms ({total_duration/1000:.3f}초)")
        print(f"   ├─ DB 쿼리 (JOIN): {query_duration:.2f}ms ({query_duration/total_duration*100:.1f}%)")
        print(f"   └─ 응답 구성: {mapping_duration:.2f}ms ({mapping_duration/total_duration*100:.1f}%)")
        print(f"📦 반환 데이터: {len(evidence_list)}개 파일")
        print(f"✨ 최적화: N+1 문제 해결 (기존 {len(evidence_list)+1}번 쿼리 → 1번 쿼리)")
        print(f"{'='*80}\n")

        return {
            "total": len(evidence_list),
            "files": evidence_list
        }

    except Exception as e:
        error_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        print(f"\n{'='*80}")
        print(f"❌ [증거 목록 조회] 실패 - {error_time}")
        print(f"❌ 에러: {str(e)}")
        print(f"{'='*80}\n")
        raise HTTPException(status_code=500, detail=f"목록 조회 실패: {str(e)}")

@router.post("/{evidence_id}/link-case/{case_id}")
async def link_evidence_to_case(
    evidence_id: int,
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거를 사건에 연결

    - evidence_id: 증거 ID
    - case_id: 사건 ID
    - 같은 law_firm_id 사용자만 연결 가능
    """
    print(f"🔗 증거-사건 연결: evidence_id={evidence_id}, case_id={case_id}, user_id={current_user.id}")

    try:
        # 1. 증거 조회 및 권한 확인
        evidence = db.query(models.Evidence).filter(models.Evidence.id == evidence_id).first()
        if not evidence:
            raise HTTPException(status_code=404, detail="증거를 찾을 수 없습니다")

        if evidence.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 증거에 접근할 권한이 없습니다")

        # 2. 이미 연결되어 있는지 확인
        existing_mapping = db.query(models.CaseEvidenceMapping).filter(
            models.CaseEvidenceMapping.evidence_id == evidence_id,
            models.CaseEvidenceMapping.case_id == case_id
        ).first()

        if existing_mapping:
            return {"message": "이미 연결되어 있습니다", "mapping_id": existing_mapping.id}

        # 3. 새 매핑 생성
        new_mapping = models.CaseEvidenceMapping(
            evidence_id=evidence_id,
            case_id=case_id
        )
        db.add(new_mapping)
        db.commit()
        db.refresh(new_mapping)

        print(f"✅ 증거-사건 연결 완료: mapping_id={new_mapping.id}")

        return {
            "message": "연결 성공",
            "mapping_id": new_mapping.id,
            "evidence_id": evidence_id,
            "case_id": case_id
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ 증거-사건 연결 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"연결 실패: {str(e)}")

@router.patch("/{evidence_id}/starred")
async def toggle_starred(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거 파일 즐겨찾기 토글

    - evidence_id: 증거 ID
    - starred 상태를 반전시킴 (true <-> false)
    """
    print(f"⭐ 즐겨찾기 토글: evidence_id={evidence_id}, user_id={current_user.id}")

    try:
        # 1. 증거 조회
        evidence = db.query(models.Evidence).filter(models.Evidence.id == evidence_id).first()
        if not evidence:
            raise HTTPException(status_code=404, detail="증거를 찾을 수 없습니다")

        # 2. 소유권 검증
        if evidence.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 증거에 접근할 권한이 없습니다")

        # 3. starred 토글
        evidence.starred = not evidence.starred if evidence.starred is not None else True
        db.commit()
        db.refresh(evidence)

        print(f"✅ 즐겨찾기 토글 완료: starred={evidence.starred}")

        return {
            "message": "즐겨찾기 상태 변경 완료",
            "evidence_id": evidence_id,
            "starred": evidence.starred
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ 즐겨찾기 토글 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"즐겨찾기 토글 실패: {str(e)}")

@router.get("/{evidence_id}/url")
async def get_signed_url(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거파일의 임시 접근 URL 생성

    - evidence_id: 증거 ID
    - 60초간 유효한 signed URL 반환
    - 보안: 같은 law_firm_id 사용자만 접근 가능
    """
    print(f"🔐 Signed URL 요청: evidence_id={evidence_id}, user_id={current_user.id}")

    # 1. DB에서 증거 파일 조회
    evidence = db.query(models.Evidence).filter(models.Evidence.id == evidence_id).first()

    if not evidence:
        raise HTTPException(status_code=404, detail="증거를 찾을 수 없습니다")

    # 2. 보안 검증: 같은 law_firm_id인지 확인
    if evidence.law_firm_id != current_user.firm_id:
        raise HTTPException(status_code=403, detail="해당 증거에 접근할 권한이 없습니다")

    # 3. Signed URL 생성 (60초 유효)
    try:
        signed_url_response = supabase.storage.from_("Evidences").create_signed_url(
            evidence.file_path,
            60  # 60초
        )

        signed_url = signed_url_response.get('signedURL')

        if not signed_url:
            raise HTTPException(status_code=500, detail="Signed URL 생성 실패")

        print(f"✅ Signed URL 생성 성공: {signed_url[:50]}...")

        return {
            "evidence_id": evidence_id,
            "file_name": evidence.file_name,
            "signed_url": signed_url,
            "expires_in": 60
        }
    except Exception as e:
        print(f"❌ Signed URL 생성 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"URL 생성 실패: {str(e)}")

