"""
판례 요약 생성 스크립트
수집된 판례 데이터(data/cases/*.json)를 기반으로 요약 생성
"""

import sys
import json
import time
from pathlib import Path
from dotenv import load_dotenv

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.qdrant_service import QdrantService
from app.services.summary_service import SummaryService
from app.prompts.summary_prompt import PROMPT_VERSION

load_dotenv()


def generate_summaries():
    """수집된 판례의 요약 생성"""
    print(f"\n판례 요약 생성 시작 (프롬프트 버전: {PROMPT_VERSION})")

    qdrant_service = QdrantService()
    summary_service = SummaryService()

    if not qdrant_service.check_connection():
        print("에러: Qdrant 서버에 연결할 수 없습니다.")
        return

    # 요약 컬렉션 생성
    qdrant_service.create_summaries_collection()

    # 저장된 판례 파일 목록 조회
    data_dir = Path(__file__).parent.parent / "data" / "cases"

    if not data_dir.exists():
        print(f"에러: 판례 데이터 폴더가 없습니다: {data_dir}")
        return

    case_files = list(data_dir.glob("*.json"))
    total_cases = len(case_files)
    print(f"총 {total_cases}건의 판례 요약을 생성합니다.\n")

    success_count = 0
    fail_count = 0
    start_time = time.time()

    for i, case_file in enumerate(case_files, 1):
        case_number = case_file.stem.replace("_", "/")

        try:
            # 판례 데이터 로드
            with open(case_file, "r", encoding="utf-8") as f:
                detail = json.load(f)

            # 전체 텍스트 구성
            full_text = _build_full_text(detail)

            if not full_text or len(full_text.strip()) < 10:
                print(f"[{i}/{total_cases}] {case_number} - 스킵 (내용 없음)")
                continue

            # 요약 생성
            summary = summary_service.summarize(full_text)

            # 저장
            if qdrant_service.save_summary(
                case_number=case_number,
                summary=summary,
                prompt_version=PROMPT_VERSION,
            ):
                success_count += 1
                elapsed = time.time() - start_time
                avg_time = elapsed / i
                remaining = avg_time * (total_cases - i)
                print(f"[{i}/{total_cases}] {case_number} - 완료 (남은 시간: {remaining/60:.1f}분)")
            else:
                fail_count += 1
                print(f"[{i}/{total_cases}] {case_number} - 저장 실패")

        except Exception as e:
            fail_count += 1
            print(f"[{i}/{total_cases}] {case_number} - 에러: {e}")

        # API 호출 제한 방지
        time.sleep(0.5)

    elapsed = time.time() - start_time
    print(f"\n요약 생성 완료!")
    print(f"  - 성공: {success_count}건")
    print(f"  - 실패: {fail_count}건")
    print(f"  - 소요 시간: {elapsed/60:.1f}분")


def _build_full_text(detail: dict) -> str:
    """판례 상세 정보에서 전체 텍스트 구성"""
    parts = []

    if detail.get("판시사항"):
        parts.append(f"【판시사항】\n{detail.get('판시사항')}")

    if detail.get("판결요지"):
        parts.append(f"【판결요지】\n{detail.get('판결요지')}")

    if detail.get("참조조문"):
        parts.append(f"【참조조문】\n{detail.get('참조조문')}")

    if detail.get("참조판례"):
        parts.append(f"【참조판례】\n{detail.get('참조판례')}")

    if detail.get("판례내용"):
        parts.append(f"【전문】\n{detail.get('판례내용')}")

    return "\n\n".join(parts)


if __name__ == "__main__":
    generate_summaries()
