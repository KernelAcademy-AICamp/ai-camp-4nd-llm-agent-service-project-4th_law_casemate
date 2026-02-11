from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, BackgroundTasks
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
from openai import AsyncOpenAI

from tool.database import get_db
from tool.security import get_current_user
from app.models.user import User
from app.models import evidence as models

# 요청 스키마
class CategoryCreateRequest(BaseModel):
    name: str
    parent_id: int | None = None
    order_index: int | None = 0

class CategoryRenameRequest(BaseModel):
    name: str

class CategoryMoveRequest(BaseModel):
    parent_id: int | None = None

# 환경변수 로드
load_dotenv()

# Supabase 설정 (Service Role Key 사용 - RLS 우회)
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 .env 파일에 설정되지 않았습니다")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

router = APIRouter()


async def process_evidence_in_background(evidence_id: int, file_content: bytes, file_name: str):
    """
    백그라운드에서 증거 파일 분석 (STT/VLM/OCR)

    Args:
        evidence_id: 증거 ID
        file_content: 파일 내용 (바이트)
        file_name: 원본 파일명
    """
    from tool.database import SessionLocal
    from io import BytesIO

    print(f"\n{'='*80}")
    print(f"🤖 [백그라운드] 증거 분석 시작: evidence_id={evidence_id}")
    print(f"{'='*80}\n")

    db = SessionLocal()
    try:
        # 1. 메모리에서 파일 내용 사용 (다운로드 불필요!)
        print(f"📄 [백그라운드] 파일 크기: {len(file_content)} bytes")
        file_like = BytesIO(file_content)

        # UploadFile 객체 생성 (processor.process에서 필요)
        from fastapi import UploadFile
        upload_file = UploadFile(filename=file_name, file=file_like)

        # 3. EvidenceProcessor로 분석
        print(f"🔍 [백그라운드] 텍스트 추출 시작...")
        processor = EvidenceProcessor()
        result = await processor.process(upload_file, detail="high")

        if result.get("success"):
            extracted_text = result.get("text", "")
            doc_type = result.get("doc_type")

            # 4. DB 업데이트
            evidence = db.query(models.Evidence).filter(models.Evidence.id == evidence_id).first()
            if evidence:
                evidence.content = extracted_text
                if doc_type:
                    evidence.doc_type = doc_type

                db.commit()

                print(f"✅ [백그라운드] 텍스트 추출 완료!")
                print(f"   - 추출된 텍스트: {len(extracted_text)}자")
                print(f"   - 문서 유형: {doc_type}")
                print(f"   - 추출 방법: {result.get('method')}")
                print(f"   - 비용 추정: {result.get('cost_estimate')}\n")

                # 5. 사건과 연결된 경우 자동 분석 트리거
                case_mappings = db.query(models.CaseEvidenceMapping).filter(
                    models.CaseEvidenceMapping.evidence_id == evidence_id
                ).all()

                if case_mappings:
                    print(f"🔗 [백그라운드] 증거가 {len(case_mappings)}개 사건과 연결됨. 자동 분석 시작...")
                    for mapping in case_mappings:
                        # 기존 분석이 없는 경우만 분석 수행
                        existing_analysis = db.query(models.EvidenceAnalysis).filter(
                            models.EvidenceAnalysis.evidence_id == evidence_id,
                            models.EvidenceAnalysis.case_id == mapping.case_id
                        ).first()

                        if not existing_analysis:
                            print(f"   📊 사건 ID {mapping.case_id}에 대한 분석 시작...")
                            await analyze_evidence_on_link_background(evidence_id, mapping.case_id)
                        else:
                            print(f"   ⏭️  사건 ID {mapping.case_id}는 이미 분석됨. 건너뜀.")
            else:
                print(f"⚠️ [백그라운드] DB에서 증거를 찾을 수 없음: evidence_id={evidence_id}")
        else:
            print(f"⚠️ [백그라운드] 텍스트 추출 실패: {result.get('error')}\n")

    except Exception as e:
        print(f"❌ [백그라운드] 증거 분석 중 오류: {str(e)}\n")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


async def analyze_evidence_on_link_background(evidence_id: int, case_id: int):
    """
    백그라운드에서 증거를 사건 맥락으로 분석

    증거가 사건에 처음 연결될 때 자동으로 호출됨

    Args:
        evidence_id: 증거 ID
        case_id: 사건 ID
    """
    from tool.database import SessionLocal
    import json
    import re

    print(f"\n{'='*80}")
    print(f"🤖 [백그라운드] 증거-사건 연결 분석 시작: evidence_id={evidence_id}, case_id={case_id}")
    print(f"{'='*80}\n")

    db = SessionLocal()
    try:
        # 1. 증거 조회
        evidence = db.query(models.Evidence).filter(models.Evidence.id == evidence_id).first()
        if not evidence:
            print(f"⚠️ [백그라운드] 증거를 찾을 수 없음: evidence_id={evidence_id}")
            return

        # 2. content 확인
        if not evidence.content or len(evidence.content.strip()) < 20:
            print(f"⚠️ [백그라운드] 분석할 텍스트가 없음 (content가 비어있거나 너무 짧음)")
            return

        # 3. 사건 정보 조회
        case = db.query(models.Case).filter(models.Case.id == case_id).first()
        if not case:
            print(f"⚠️ [백그라운드] 사건을 찾을 수 없음: case_id={case_id}")
            return

        case_context = f"""

**사건 맥락:**
- 사건명: {case.title}
- 사건 유형: {case.case_type if case.case_type else '미분류'}
- 의뢰인: {case.client_name} ({case.client_role})
- 상대방: {case.opponent_name} ({case.opponent_role})
- 사건 설명: {case.description[:300] if case.description else '없음'}
"""

        # 4. AI 분석 수행
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            print(f"⚠️ [백그라운드] OPENAI_API_KEY가 설정되지 않음")
            return

        client = AsyncOpenAI(api_key=api_key)

        print(f"🤖 [백그라운드] AI 분석 중... (텍스트 길이: {len(evidence.content)}자)")

        # 분석 프롬프트
        prompt = f"""당신은 법률 전문가입니다. 다음 증거 자료를 특정 사건의 맥락에서 분석해주세요.

**파일명:** {evidence.file_name}
**문서 유형:** {evidence.doc_type if evidence.doc_type else '미분류'}
{case_context}
**증거 내용:**
{evidence.content}

---

다음 형식으로 JSON 응답을 작성해주세요:

```json
{{
  "summary": "증거 내용을 3-5문장으로 요약",
  "legal_relevance": "이 사건에서 이 증거가 법적으로 어떤 의미를 가지는지, 어떤 주장을 뒷받침하는지 분석 (3-5문장)",
  "risk_level": "high, medium, low 중 하나 (상대방에게 불리한 정도)"
}}
```

**주의사항:**
- summary: 핵심 내용만 간결하게 요약
- legal_relevance: 사건 맥락을 고려하여 법적 쟁점, 증거 가치, 활용 방안을 구체적으로 작성
- risk_level: 상대방 입장에서 불리한 정도를 평가 (높을수록 우리에게 유리)
"""

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "당신은 법률 증거 분석 전문가입니다."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=1500
        )

        content = response.choices[0].message.content or ""

        # JSON 파싱
        try:
            # JSON 코드블록 제거
            json_match = re.search(r'```json\s*(.*?)\s*```', content, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
            else:
                json_str = content

            parsed = json.loads(json_str)
            summary = parsed.get("summary", "")
            legal_relevance = parsed.get("legal_relevance", "")
            risk_level = parsed.get("risk_level", "medium")

            print(f"✅ [백그라운드] AI 분석 완료: risk_level={risk_level}")

        except (json.JSONDecodeError, AttributeError) as e:
            print(f"⚠️ [백그라운드] JSON 파싱 실패: {str(e)}")
            summary = content[:500]
            legal_relevance = "자동 분석 실패"
            risk_level = "medium"

        # 5. DB 저장 (기존 분석이 있으면 업데이트, 없으면 생성)
        existing_analysis = db.query(models.EvidenceAnalysis).filter(
            models.EvidenceAnalysis.evidence_id == evidence_id,
            models.EvidenceAnalysis.case_id == case_id
        ).first()

        if existing_analysis:
            # 업데이트
            existing_analysis.summary = summary
            existing_analysis.legal_relevance = legal_relevance
            existing_analysis.risk_level = risk_level
            existing_analysis.ai_model = "gpt-4o-mini"
            existing_analysis.created_at = func.now()
            db.commit()
            print(f"✅ [백그라운드] 분석 업데이트 완료: analysis_id={existing_analysis.id}")
        else:
            # 새로 생성
            new_analysis = models.EvidenceAnalysis(
                evidence_id=evidence_id,
                case_id=case_id,
                summary=summary,
                legal_relevance=legal_relevance,
                risk_level=risk_level,
                ai_model="gpt-4o-mini"
            )
            db.add(new_analysis)
            db.commit()
            print(f"✅ [백그라운드] 분석 생성 완료: case_id={case_id}")

    except Exception as e:
        print(f"❌ [백그라운드] 증거-사건 연결 분석 중 오류: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


@router.post("/upload")
async def upload_file(
    background_tasks: BackgroundTasks,
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
            category_id=category_id  # 카테고리 ID (선택적)
        )
        db.add(new_evidence)
        db.commit()
        db.refresh(new_evidence)

        # case_id가 전달된 경우 매핑 테이블로 연결
        if case_id is not None:
            new_mapping = models.CaseEvidenceMapping(
                case_id=case_id,
                evidence_id=new_evidence.id
            )
            db.add(new_mapping)
            db.commit()

        # 백그라운드에서 텍스트 추출 (STT/OCR/VLM)
        # 파일 내용을 직접 전달 (재다운로드 불필요!)
        print(f"📋 백그라운드 분석 작업 등록: evidence_id={new_evidence.id}")
        background_tasks.add_task(
            process_evidence_in_background,
            new_evidence.id,
            file_content,  # 이미 메모리에 있는 파일 내용
            file.filename
        )

        return {
            "message": "업로드 성공",
            "evidence_id": new_evidence.id,
            "file_name": file.filename,
            "url": signed_url,
            "case_id": case_id,
            "category_id": new_evidence.category_id,
            "processing_status": "분석 진행 중 (백그라운드)",
            "info": "파일 업로드가 완료되었습니다. 텍스트 추출은 백그라운드에서 진행됩니다."
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
    증거 카테고리 삭제 (하위 폴더 포함 재귀 삭제)

    - category_id: 삭제할 카테고리 ID
    - 하위 카테고리가 있으면 함께 삭제
    - 해당 폴더 및 하위 폴더의 파일은 미분류(category_id=NULL)로 이동
    """
    print(f"🗑️ 카테고리 삭제 요청: category_id={category_id}, user_id={current_user.id}, firm_id={current_user.firm_id}")

    try:
        category = db.query(models.EvidenceCategory).filter(
            models.EvidenceCategory.id == category_id
        ).first()

        if not category:
            raise HTTPException(status_code=404, detail="카테고리를 찾을 수 없습니다")

        if category.firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 카테고리를 삭제할 권한이 없습니다")

        # 하위 카테고리 ID 재귀 수집
        all_ids = []
        def collect_children(parent_id):
            all_ids.append(parent_id)
            children = db.query(models.EvidenceCategory).filter(
                models.EvidenceCategory.parent_id == parent_id
            ).all()
            for child in children:
                collect_children(child.id)

        collect_children(category_id)

        # 해당 폴더들의 파일을 미분류로 이동
        db.query(models.Evidence).filter(
            models.Evidence.category_id.in_(all_ids)
        ).update({models.Evidence.category_id: None}, synchronize_session='fetch')

        # 하위부터 역순으로 삭제 (FK 제약 회피)
        for cid in reversed(all_ids):
            db.query(models.EvidenceCategory).filter(
                models.EvidenceCategory.id == cid
            ).delete()

        db.commit()
        print(f"✅ 카테고리 삭제 완료: {len(all_ids)}개 폴더 삭제 (id: {all_ids})")

        return {"message": "카테고리 삭제 완료", "deleted_count": len(all_ids)}

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

@router.patch("/categories/{category_id}/rename")
async def rename_category(
    category_id: int,
    request: CategoryRenameRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거 카테고리 이름 변경

    - category_id: 이름을 변경할 카테고리 ID
    - name: 새로운 카테고리명
    - firm_id 소유권 검증 후 이름 변경
    """
    print(f"✏️ 카테고리 이름 변경: category_id={category_id}, new_name={request.name}")

    try:
        # 1. 카테고리 조회
        category = db.query(models.EvidenceCategory).filter(
            models.EvidenceCategory.id == category_id
        ).first()

        if not category:
            raise HTTPException(status_code=404, detail="카테고리를 찾을 수 없습니다")

        # 2. 소유권 검증
        if category.firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 카테고리를 수정할 권한이 없습니다")

        # 3. 이름 변경
        category.name = request.name
        db.commit()
        db.refresh(category)

        print(f"✅ 카테고리 이름 변경 완료: category_id={category_id}, name={category.name}")

        return {
            "message": "이름 변경 완료",
            "category_id": category.id,
            "name": category.name
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ 카테고리 이름 변경 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"카테고리 이름 변경 실패: {str(e)}")

@router.patch("/categories/{category_id}/move")
async def move_category(
    category_id: int,
    request: CategoryMoveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거 카테고리를 다른 부모 카테고리로 이동

    - category_id: 이동할 카테고리 ID
    - parent_id: 새 부모 카테고리 ID (None이면 루트로 이동)
    - firm_id 소유권 검증
    - 순환 참조 방지 (자기 자신의 하위 카테고리로 이동 불가)
    """
    print(f"📦 카테고리 이동: category_id={category_id}, new_parent_id={request.parent_id}")

    try:
        # 1. 카테고리 조회
        category = db.query(models.EvidenceCategory).filter(
            models.EvidenceCategory.id == category_id
        ).first()

        if not category:
            raise HTTPException(status_code=404, detail="카테고리를 찾을 수 없습니다")

        # 2. 소유권 검증
        if category.firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 카테고리를 이동할 권한이 없습니다")

        # 3. 새 부모 카테고리 검증 (parent_id가 None이 아닌 경우)
        if request.parent_id is not None:
            parent_category = db.query(models.EvidenceCategory).filter(
                models.EvidenceCategory.id == request.parent_id
            ).first()

            if not parent_category:
                raise HTTPException(status_code=404, detail="대상 부모 카테고리를 찾을 수 없습니다")

            if parent_category.firm_id != current_user.firm_id:
                raise HTTPException(status_code=403, detail="대상 부모 카테고리에 접근할 권한이 없습니다")

            # 4. 순환 참조 방지: 새 부모가 자기 자신이거나 자신의 하위인지 확인
            if request.parent_id == category_id:
                raise HTTPException(status_code=400, detail="자기 자신을 부모로 설정할 수 없습니다")

            # 하위 카테고리 순회하여 순환 참조 검사
            current_parent_id = parent_category.parent_id
            while current_parent_id is not None:
                if current_parent_id == category_id:
                    raise HTTPException(status_code=400, detail="순환 참조가 발생합니다. 하위 카테고리로 이동할 수 없습니다")
                ancestor = db.query(models.EvidenceCategory).filter(
                    models.EvidenceCategory.id == current_parent_id
                ).first()
                if not ancestor:
                    break
                current_parent_id = ancestor.parent_id

        # 5. 부모 변경
        category.parent_id = request.parent_id
        db.commit()
        db.refresh(category)

        print(f"✅ 카테고리 이동 완료: category_id={category_id}, parent_id={category.parent_id}")

        return {
            "message": "이동 완료",
            "category_id": category.id,
            "parent_id": category.parent_id
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ 카테고리 이동 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"카테고리 이동 실패: {str(e)}")

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


@router.get("/{evidence_id}")
async def get_evidence_detail(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거 단일 조회

    - 증거 상세 정보 반환 (파일 정보, content, 연결된 사건 ID 등)
    - 권한 확인: 같은 law_firm_id만 조회 가능
    """
    print(f"📄 증거 상세 조회: evidence_id={evidence_id}, user_id={current_user.id}, firm_id={current_user.firm_id}")

    try:
        # 증거 조회
        evidence = db.query(models.Evidence).filter(
            models.Evidence.id == evidence_id,
            models.Evidence.law_firm_id == current_user.firm_id
        ).first()

        if not evidence:
            raise HTTPException(status_code=404, detail="증거를 찾을 수 없거나 접근 권한이 없습니다")

        # 연결된 사건 ID 조회
        linked_cases = db.query(models.CaseEvidenceMapping.case_id).filter(
            models.CaseEvidenceMapping.evidence_id == evidence_id
        ).all()
        linked_case_ids = [case[0] for case in linked_cases]

        # 응답 데이터 구성
        result = {
            "evidence_id": evidence.id,
            "file_name": evidence.file_name,
            "file_type": evidence.file_type,
            "file_size": evidence.size if evidence.size else 0,
            "file_path": evidence.file_path,
            "content": evidence.content,  # OCR/VLM/STT 결과
            "starred": evidence.starred if evidence.starred is not None else False,
            "linked_case_ids": linked_case_ids,
            "category_id": evidence.category_id,
            "created_at": evidence.created_at.isoformat() if evidence.created_at else None,
            "uploader_id": evidence.uploader_id
        }

        print(f"✅ 증거 상세 조회 성공: {evidence.file_name}")
        return result

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 증거 상세 조회 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"증거 조회 실패: {str(e)}")


@router.post("/{evidence_id}/link-case/{case_id}")
async def link_evidence_to_case(
    evidence_id: int,
    case_id: int,
    background_tasks: BackgroundTasks,
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

        # 4. 백그라운드에서 증거 분석 (사건 맥락 포함)
        background_tasks.add_task(analyze_evidence_on_link_background, evidence_id, case_id)
        print(f"🤖 백그라운드 분석 작업 예약: evidence_id={evidence_id}, case_id={case_id}")

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

@router.delete("/{evidence_id}/unlink-case/{case_id}")
async def unlink_evidence_from_case(
    evidence_id: int,
    case_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거와 사건 연결 해제 (파일 자체는 보존)
    """
    try:
        evidence = db.query(models.Evidence).filter(models.Evidence.id == evidence_id).first()
        if not evidence:
            raise HTTPException(status_code=404, detail="증거를 찾을 수 없습니다")

        if evidence.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 증거에 접근할 권한이 없습니다")

        deleted = db.query(models.CaseEvidenceMapping).filter(
            models.CaseEvidenceMapping.evidence_id == evidence_id,
            models.CaseEvidenceMapping.case_id == case_id
        ).delete()

        db.commit()

        if deleted == 0:
            raise HTTPException(status_code=404, detail="해당 연결을 찾을 수 없습니다")

        return {"message": "연결 해제 완료", "evidence_id": evidence_id, "case_id": case_id}

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"연결 해제 실패: {str(e)}")


@router.post("/{evidence_id}/link-case-with-details/{case_id}")
async def link_evidence_to_case_with_details(
    evidence_id: int,
    case_id: int,
    evidence_date: str | None = None,
    description: str | None = None,
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거를 사건에 연결 (날짜 및 설명 포함)

    - evidence_id: 증거 ID
    - case_id: 사건 ID
    - evidence_date: (선택) 증거 발생일
    - description: (선택) 증거 설명
    - 같은 law_firm_id 사용자만 연결 가능
    """
    print(f"🔗 증거-사건 연결 (상세): evidence_id={evidence_id}, case_id={case_id}, date={evidence_date}, desc={description}")

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
            # 이미 존재하면 날짜와 설명 업데이트
            existing_mapping.evidence_date = evidence_date
            existing_mapping.description = description
            db.commit()
            db.refresh(existing_mapping)
            print(f"✅ 기존 매핑 업데이트: mapping_id={existing_mapping.id}")
            return {
                "message": "기존 연결 정보 업데이트",
                "mapping_id": existing_mapping.id,
                "evidence_id": evidence_id,
                "case_id": case_id
            }

        # 3. 새 매핑 생성
        new_mapping = models.CaseEvidenceMapping(
            evidence_id=evidence_id,
            case_id=case_id,
            evidence_date=evidence_date,
            description=description
        )
        db.add(new_mapping)
        db.commit()
        db.refresh(new_mapping)

        print(f"✅ 증거-사건 연결 완료: mapping_id={new_mapping.id}")

        # 4. 백그라운드에서 증거 분석 (사건 맥락 포함)
        if background_tasks:
            background_tasks.add_task(analyze_evidence_on_link_background, evidence_id, case_id)
            print(f"🤖 백그라운드 분석 작업 예약: evidence_id={evidence_id}, case_id={case_id}")

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

@router.get("/{evidence_id}/analysis")
async def get_evidence_analysis(
    evidence_id: int,
    case_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거 분석 정보 조회

    - evidence_id: 증거 ID
    - case_id: (선택) 사건 ID - 특정 사건 맥락의 분석 조회
    - 해당 증거의 분석 정보 반환 (없으면 null)
    """
    print(f"📊 분석 정보 조회: evidence_id={evidence_id}, case_id={case_id}, user_id={current_user.id}")

    try:
        # 1. 증거 조회 및 권한 확인
        evidence = db.query(models.Evidence).filter(models.Evidence.id == evidence_id).first()
        if not evidence:
            raise HTTPException(status_code=404, detail="증거를 찾을 수 없습니다")

        if evidence.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 증거에 접근할 권한이 없습니다")

        # 2. 분석 정보 조회 (case_id로 필터링)
        query = db.query(models.EvidenceAnalysis).filter(
            models.EvidenceAnalysis.evidence_id == evidence_id
        )

        if case_id is not None:
            query = query.filter(models.EvidenceAnalysis.case_id == case_id)

        analysis = query.order_by(models.EvidenceAnalysis.created_at.desc()).first()

        if not analysis:
            print(f"📊 분석 정보 없음: evidence_id={evidence_id}, case_id={case_id}")
            return {
                "has_analysis": False,
                "analysis": None
            }

        print(f"✅ 분석 정보 조회 완료: analysis_id={analysis.id}")

        return {
            "has_analysis": True,
            "analysis": {
                "id": analysis.id,
                "case_id": analysis.case_id,
                "summary": analysis.summary,
                "legal_relevance": analysis.legal_relevance,
                "risk_level": analysis.risk_level,
                "ai_model": analysis.ai_model,
                "created_at": analysis.created_at.isoformat() if analysis.created_at else None
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 분석 정보 조회 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"분석 정보 조회 실패: {str(e)}")

@router.post("/{evidence_id}/analyze")
async def analyze_evidence(
    evidence_id: int,
    case_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    증거 분석 수행

    - evidence_id: 증거 ID
    - case_id: (선택) 사건 ID - 특정 사건 맥락에서 분석
    - 증거의 content를 AI로 분석하여 요약, 법적 관련성, 위험도 평가
    - 결과를 evidence_analyses 테이블에 저장
    """
    print(f"🤖 증거 분석 시작: evidence_id={evidence_id}, case_id={case_id}, user_id={current_user.id}")

    try:
        # 1. 증거 조회 및 권한 확인
        evidence = db.query(models.Evidence).filter(models.Evidence.id == evidence_id).first()
        if not evidence:
            raise HTTPException(status_code=404, detail="증거를 찾을 수 없습니다")

        if evidence.law_firm_id != current_user.firm_id:
            raise HTTPException(status_code=403, detail="해당 증거에 접근할 권한이 없습니다")

        # 2. content 확인
        if not evidence.content or len(evidence.content.strip()) < 20:
            raise HTTPException(
                status_code=400,
                detail="분석할 텍스트가 없습니다. 먼저 텍스트 추출을 수행해주세요."
            )

        # 3. AI 분석 수행
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="OPENAI_API_KEY가 설정되지 않았습니다")

        client = AsyncOpenAI(api_key=api_key)

        print(f"🤖 AI 분석 중... (텍스트 길이: {len(evidence.content)}자)")

        # 사건 정보 조회 (case_id가 있는 경우)
        case_context = ""
        if case_id:
            case = db.query(models.Case).filter(models.Case.id == case_id).first()
            if case:
                case_context = f"""

**사건 맥락:**
- 사건명: {case.title}
- 사건 유형: {case.case_type if case.case_type else '미분류'}
- 의뢰인: {case.client_name} ({case.client_role})
- 상대방: {case.opponent_name} ({case.opponent_role})
- 사건 설명: {case.description[:300] if case.description else '없음'}
"""

        # 분석 프롬프트
        prompt = f"""당신은 법률 전문가입니다. 다음 증거 자료를 {"특정 사건의 맥락에서 " if case_id else ""}분석해주세요.

**파일명:** {evidence.file_name}
**문서 유형:** {evidence.doc_type if evidence.doc_type else '미분류'}
{case_context}
**증거 내용:**
{evidence.content}

---

다음 형식으로 JSON 응답을 작성해주세요:

```json
{{
  "summary": "증거 내용을 3-5문장으로 요약",
  "legal_relevance": "{"이 사건에서 " if case_id else ""}이 증거가 법적으로 어떤 의미를 가지는지, 어떤 주장을 뒷받침하는지 분석 (3-5문장)",
  "risk_level": "high, medium, low 중 하나 (상대방에게 불리한 정도)"
}}
```

**주의사항:**
- summary: 핵심 내용만 간결하게 요약
- legal_relevance: {"사건 맥락을 고려하여 " if case_id else ""}법적 쟁점, 증거 가치, 활용 방안을 구체적으로 작성
- risk_level: 상대방 입장에서 불리한 정도를 평가 (높을수록 우리에게 유리)
"""

        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "당신은 법률 증거 분석 전문가입니다."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=1500
        )

        content = response.choices[0].message.content or ""

        # JSON 파싱
        import json
        import re

        try:
            # JSON 코드블록 제거
            json_match = re.search(r'```json\s*(.*?)\s*```', content, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
            else:
                json_str = content

            parsed = json.loads(json_str)
            summary = parsed.get("summary", "")
            legal_relevance = parsed.get("legal_relevance", "")
            risk_level = parsed.get("risk_level", "medium")

            print(f"✅ AI 분석 완료: risk_level={risk_level}")

        except (json.JSONDecodeError, AttributeError) as e:
            print(f"⚠️ JSON 파싱 실패: {str(e)}")
            # 파싱 실패 시 전체 응답을 summary로 사용
            summary = content[:500]
            legal_relevance = "자동 분석 실패"
            risk_level = "medium"

        # 4. DB 저장 (기존 분석이 있으면 업데이트, 없으면 생성)
        query = db.query(models.EvidenceAnalysis).filter(
            models.EvidenceAnalysis.evidence_id == evidence_id
        )
        if case_id is not None:
            query = query.filter(models.EvidenceAnalysis.case_id == case_id)

        existing_analysis = query.first()

        if existing_analysis:
            # 기존 분석 업데이트
            existing_analysis.summary = summary
            existing_analysis.legal_relevance = legal_relevance
            existing_analysis.risk_level = risk_level
            existing_analysis.ai_model = "gpt-4o-mini"
            existing_analysis.created_at = func.now()
            db.commit()
            db.refresh(existing_analysis)

            print(f"✅ 분석 업데이트 완료: analysis_id={existing_analysis.id}")

            return {
                "message": "분석 완료 (업데이트)",
                "analysis": {
                    "id": existing_analysis.id,
                    "case_id": existing_analysis.case_id,
                    "summary": existing_analysis.summary,
                    "legal_relevance": existing_analysis.legal_relevance,
                    "risk_level": existing_analysis.risk_level,
                    "ai_model": existing_analysis.ai_model,
                    "created_at": existing_analysis.created_at.isoformat()
                }
            }
        else:
            # 새 분석 생성
            new_analysis = models.EvidenceAnalysis(
                evidence_id=evidence_id,
                case_id=case_id,
                summary=summary,
                legal_relevance=legal_relevance,
                risk_level=risk_level,
                ai_model="gpt-4o-mini"
            )
            db.add(new_analysis)
            db.commit()
            db.refresh(new_analysis)

            print(f"✅ 분석 생성 완료: analysis_id={new_analysis.id}, case_id={case_id}")

            return {
                "message": "분석 완료",
                "analysis": {
                    "id": new_analysis.id,
                    "case_id": new_analysis.case_id,
                    "summary": new_analysis.summary,
                    "legal_relevance": new_analysis.legal_relevance,
                    "risk_level": new_analysis.risk_level,
                    "ai_model": new_analysis.ai_model,
                    "created_at": new_analysis.created_at.isoformat()
                }
            }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"❌ 증거 분석 실패: {str(e)}")
        raise HTTPException(status_code=500, detail=f"증거 분석 실패: {str(e)}")

