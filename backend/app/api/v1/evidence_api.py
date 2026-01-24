from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime
import os
import uuid

from tool.database import get_db
from tool.security import get_current_user
from app.models.user import User
from app.models import evidence as models

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
    case_id: int | None = None,  # 선택적 파라미터: 사건에 연결할 경우에만 제공
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)  # 로그인 확인
):
    """
    증거파일 업로드

    - file: 업로드할 파일 (한글 파일명 지원)
    - case_id: (선택) 사건 ID - 특정 사건에 연결할 경우에만 제공
    - 인증된 사용자만 업로드 가능

    **응답:**
    - evidence_id: 생성된 증거 ID
    - file_name: 원본 파일명 (한글 포함)
    - url: Supabase Storage 공개 URL
    - case_linked: 사건 연결 여부
    """
    print("=" * 50)
    print(f"🎉 Upload Evidence endpoint called!")
    print(f"📁 파일명: {file.filename}")
    print(f"📋 사건 ID: {case_id if case_id else '미연결'}")
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

        # 4. Signed URL 생성 (60분 유효)
        signed_url_response = supabase.storage.from_("Evidences").create_signed_url(file_path, 3600)
        signed_url = signed_url_response.get('signedURL') if signed_url_response else ""
        print(f"🔗 Signed URL: {signed_url}")

        # 5. DB 저장
        # (1) evidences 테이블에 기록
        new_evidence = models.Evidence(
            uploader_id=current_user.id,
            law_firm_id=current_user.firm_id,  # 사용자의 사무실 ID 저장
            file_name=file.filename,  # 원본 파일명 저장 (한글 지원)
            file_url=signed_url,  # Signed URL 저장
            file_path=file_path,  # Storage 내부 경로 저장 (재생성용)
            file_type=file.content_type
        )
        db.add(new_evidence)
        db.commit()
        db.refresh(new_evidence)

        # (2) 사건과의 매핑 테이블 기록 (case_id가 제공된 경우에만)
        case_linked = False
        if case_id is not None:
            new_mapping = models.CaseEvidenceMapping(
                case_id=case_id,
                evidence_id=new_evidence.id
            )
            db.add(new_mapping)
            db.commit()
            case_linked = True

        return {
            "message": "업로드 성공",
            "evidence_id": new_evidence.id,
            "file_name": file.filename,
            "url": signed_url,
            "case_linked": case_linked
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"업로드 실패: {str(e)}")

@router.get("/{evidence_id}/url")
async def get_signed_url(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거파일의 임시 접근 URL 생성

    - evidence_id: 증거 ID
    - 60분간 유효한 signed URL 반환
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

    # 3. Signed URL 생성 (60분 유효)
    try:
        signed_url_response = supabase.storage.from_("Evidences").create_signed_url(
            evidence.file_path,
            3600  # 60분 = 3600초
        )

        signed_url = signed_url_response.get('signedURL')

        if not signed_url:
            raise HTTPException(status_code=500, detail="Signed URL 생성 실패")

        print(f"✅ Signed URL 생성 성공: {signed_url[:50]}...")

        return {
            "evidence_id": evidence_id,
            "file_name": evidence.file_name,
            "signed_url": signed_url,
            "expires_in": 3600
        }
    except Exception as e:
        print(f"❌ Signed URL 생성 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"URL 생성 실패: {str(e)}")
