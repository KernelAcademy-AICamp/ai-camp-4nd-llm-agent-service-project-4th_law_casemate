"""
절차법 수집 스크립트 (민사소송법, 형사소송법)

기존 DB 구조를 그대로 유지하며 신규 법령을 추가합니다.
- Parent: 조문 전체 단위
- Child: 항(①②③) 단위
- law_role: "procedure"
"""

import os
import sys
import json
import asyncio
import hashlib
import time
import re
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from dotenv import load_dotenv
import openai
from openai import OpenAI

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.law_api_service import LawAPIClient
from qdrant_client import QdrantClient
from qdrant_client.http import models

load_dotenv()

# 설정
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
COLLECTION_NAME = "laws_hybrid"

# 수집 대상 절차법
TARGET_LAWS = ["민사소송법"]  # 형사소송법은 이미 완료


class ProcedureLawCollector:
    """절차법 수집기 (부모-자식 구조 적용)"""

    def __init__(self):
        self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.qdrant_client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
        self.data_dir = Path(__file__).parent.parent / "data" / "laws"
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def generate_point_id(self, id_string: str) -> int:
        """고유 포인트 ID 생성 (MD5 해시 기반)"""
        hash_hex = hashlib.md5(id_string.encode()).hexdigest()[:16]
        return int(hash_hex, 16)

    # ==================== 1. 법령 데이터 수집 ====================

    async def fetch_law_data(self, law_name: str) -> Optional[Dict[str, Any]]:
        """API에서 법령 데이터 가져오기"""
        print(f"\n{'='*50}")
        print(f"[1단계] '{law_name}' 데이터 수집")
        print(f"{'='*50}")

        async with LawAPIClient() as client:
            print(f"  - '{law_name}' 검색 중...")
            search_result = await client.search_laws(
                query=law_name,
                law_type="법률",
                display=10
            )

            laws = search_result.get("LawSearch", {}).get("law", [])

            # 단일 결과인 경우 리스트로 변환
            if isinstance(laws, dict):
                laws = [laws]
            elif isinstance(laws, str):
                print(f"  - 검색 결과가 예상과 다릅니다: {laws[:100]}")
                laws = []

            target_law = None

            for law in laws:
                if isinstance(law, dict) and law.get("법령명한글") == law_name:
                    target_law = law
                    break

            if not target_law:
                print(f"  - '{law_name}'을 찾을 수 없습니다.")
                return None

            mst = target_law.get("법령일련번호")
            print(f"  - 찾음: {target_law.get('법령명한글')} (MST: {mst})")

            print(f"  - 상세 데이터 조회 중...")
            detail = await client.get_law_detail(mst)

            # 백업 저장
            backup_path = self.data_dir / f"{law_name}.json"
            with open(backup_path, "w", encoding="utf-8") as f:
                json.dump(detail, f, ensure_ascii=False, indent=2)
            print(f"  - 원본 저장: {backup_path}")

            return detail

    # ==================== 2. 부모-자식 구조 추출 ====================

    def extract_parent_child_structure(
        self, law_data: Dict[str, Any], law_name: str
    ) -> Tuple[List[Dict], List[Dict]]:
        """
        법령 데이터에서 부모-자식 구조 추출

        Returns:
            (parents, children) 튜플
        """
        print(f"\n[2단계] 부모-자식 구조 추출 중...")

        parents = []
        children = []

        law_service = law_data.get("법령", {})
        article_list = law_service.get("조문", {}).get("조문단위", [])

        if isinstance(article_list, dict):
            article_list = [article_list]

        for article in article_list:
            article_num = article.get("조문번호", "").strip()
            article_title = article.get("조문제목", "").strip()
            article_content = article.get("조문내용", "").strip()

            if not article_content:
                continue

            # Parent ID 생성
            parent_id_string = f"law_parent_{law_name}_{article_num}"
            parent_id = self.generate_point_id(parent_id_string)

            # 항(paragraph) 추출
            paragraphs = article.get("항", [])
            if isinstance(paragraphs, dict):
                paragraphs = [paragraphs]

            # 항이 있으면 Parent + Children 구조
            if paragraphs and any(p.get("항내용") for p in paragraphs if isinstance(p, dict)):
                # Parent: 조문 전체 내용
                full_content = article_content
                for para in paragraphs:
                    if isinstance(para, dict):
                        para_content = para.get("항내용", "")
                        if para_content:
                            full_content += f"\n{para_content}"

                parents.append({
                    "id": parent_id,
                    "id_string": parent_id_string,
                    "law_name": law_name,
                    "article_number": article_num,
                    "article_title": article_title,
                    "content": full_content.strip(),
                    "point_type": "parent",
                    "law_role": "procedure",
                })

                # Children: 각 항 단위
                for idx, para in enumerate(paragraphs):
                    if not isinstance(para, dict):
                        continue
                    para_content = para.get("항내용", "")
                    if not para_content:
                        continue

                    child_id_string = f"law_child_{law_name}_{article_num}_{idx}"
                    child_id = self.generate_point_id(child_id_string)

                    children.append({
                        "id": child_id,
                        "id_string": child_id_string,
                        "law_name": law_name,
                        "article_number": article_num,
                        "article_title": article_title,
                        "content": para_content.strip(),
                        "point_type": "child",
                        "parent_id": parent_id,
                        "child_index": idx,
                        "law_role": "procedure",
                    })

            else:
                # 항이 없으면 Parent만 (단일 조문)
                parents.append({
                    "id": parent_id,
                    "id_string": parent_id_string,
                    "law_name": law_name,
                    "article_number": article_num,
                    "article_title": article_title,
                    "content": article_content.strip(),
                    "point_type": "parent",
                    "law_role": "procedure",
                })

        print(f"  - Parent: {len(parents)}개")
        print(f"  - Child: {len(children)}개")
        print(f"  - 총: {len(parents) + len(children)}개")

        return parents, children

    # ==================== 3. 임베딩 생성 ====================

    def create_embeddings(self, items: List[Dict]) -> List[Dict]:
        """임베딩 생성"""
        print(f"\n[3단계] 임베딩 생성 중... ({len(items)}개)")

        results = []
        batch_size = 20

        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]

            texts = [
                f"{item['law_name']} 제{item['article_number']}조 {item['article_title']}\n{item['content']}"
                for item in batch
            ]

            for attempt in range(3):
                try:
                    response = self.openai_client.embeddings.create(
                        model="text-embedding-3-small",
                        input=texts
                    )

                    for j, item in enumerate(batch):
                        item_with_vector = item.copy()
                        item_with_vector["vector"] = response.data[j].embedding
                        results.append(item_with_vector)
                    break  # 성공 시 루프 탈출

                except openai.RateLimitError:
                    print(f"  - Rate limit 도달, 5초 대기 후 재시도 ({attempt + 1}/3)")
                    time.sleep(5)
                except Exception as e:
                    print(f"  - 임베딩 생성 실패: {e}")
                    break

            print(f"  - 진행: {min(i + batch_size, len(items))}/{len(items)}")

        return results

    # ==================== 4. Qdrant 저장 ====================

    def save_to_qdrant(self, items: List[Dict]) -> int:
        """Qdrant에 저장"""
        print(f"\n[4단계] Qdrant에 저장 중... ({len(items)}개)")

        points = []
        for item in items:
            payload = {
                "law_name": item["law_name"],
                "article_number": item["article_number"],
                "article_title": item["article_title"],
                "content": item["content"],
                "type": "law",
                "point_type": item["point_type"],
                "id_string": item["id_string"],
                "law_role": item["law_role"],
            }

            # Child 전용 필드
            if item["point_type"] == "child":
                payload["parent_id"] = item["parent_id"]
                payload["child_index"] = item["child_index"]

            points.append(models.PointStruct(
                id=item["id"],
                vector=item["vector"],
                payload=payload,
            ))

        # 배치 저장
        batch_size = 100
        saved = 0

        for i in range(0, len(points), batch_size):
            batch = points[i:i + batch_size]
            self.qdrant_client.upsert(
                collection_name=COLLECTION_NAME,
                points=batch,
            )
            saved += len(batch)
            print(f"  - 저장: {saved}/{len(points)}")

        return saved

    # ==================== 메인 실행 ====================

    async def collect_all(self):
        """모든 대상 법령 수집"""
        print("\n" + "=" * 60)
        print("절차법 데이터 수집 시작")
        print(f"대상: {', '.join(TARGET_LAWS)}")
        print("구조: Parent(조문) + Child(항) + law_role=procedure")
        print("=" * 60)

        # Qdrant 연결 확인
        try:
            self.qdrant_client.get_collection(COLLECTION_NAME)
            print(f"Qdrant '{COLLECTION_NAME}' 컬렉션 연결 확인")
        except Exception as e:
            print(f"Qdrant 연결 실패: {e}")
            return

        total_saved = 0

        for law_name in TARGET_LAWS:
            try:
                # 1. 데이터 수집
                law_data = await self.fetch_law_data(law_name)
                if not law_data:
                    continue

                # 2. 부모-자식 구조 추출
                parents, children = self.extract_parent_child_structure(law_data, law_name)
                if not parents:
                    print(f"  - '{law_name}'에서 조문을 추출할 수 없습니다.")
                    continue

                # 3. 임베딩 생성
                all_items = parents + children
                items_with_vectors = self.create_embeddings(all_items)

                # 4. Qdrant 저장
                saved = self.save_to_qdrant(items_with_vectors)
                total_saved += saved

                print(f"\n'{law_name}' 완료: {saved}개 저장")

            except Exception as e:
                print(f"  - '{law_name}' 처리 중 에러: {e}")
                import traceback
                traceback.print_exc()
                continue

        # 결과 출력
        print("\n" + "=" * 60)
        print("수집 완료!")
        print(f"총 저장된 포인트 수: {total_saved}개")

        # 컬렉션 상태 확인
        info = self.qdrant_client.get_collection(COLLECTION_NAME)
        print(f"'{COLLECTION_NAME}' 컬렉션 현재 상태: {info.points_count}개 포인트")
        print("=" * 60)


async def main():
    collector = ProcedureLawCollector()
    await collector.collect_all()


if __name__ == "__main__":
    asyncio.run(main())
