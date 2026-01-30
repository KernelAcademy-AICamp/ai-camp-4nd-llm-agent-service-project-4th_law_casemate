"""
법령 데이터 수집 스크립트
민법, 형법 데이터를 국가법령정보 API에서 가져와 Qdrant에 저장합니다.
"""

import os
import sys
import json
import asyncio
import hashlib
import time
from pathlib import Path
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from openai import OpenAI

# 프로젝트 루트를 path에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from tool.law_api_client import LawAPIClient
from tool.qdrant_client import QdrantService

load_dotenv()


class LawCollector:
    """법령 데이터 수집기"""

    # 수집할 법령 목록
    #TARGET_LAWS = ["민법", "형법", "근로기준법", "노동위원회법", "정보통신망 이용촉진 및 정보보호 등에 관한 법률", "언론중재 및 피해구제 등에 관한 법률", "개인정보 보호법", "남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률"]
    TARGET_LAWS = ["민법"]

    def __init__(self):
        self.openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.qdrant_service = QdrantService()
        self.data_dir = Path(__file__).parent.parent / "data" / "laws"
        self.data_dir.mkdir(parents=True, exist_ok=True)

    # ==================== 1. 법령 데이터 수집 ====================

    async def fetch_law_data(self, law_name: str) -> Optional[Dict[str, Any]]:
        """
        특정 법령의 데이터를 API에서 가져오기

        Args:
            law_name: 법령명 (예: "민법", "형법")

        Returns:
            법령 상세 데이터 (JSON)
        """
        print(f"\n{'='*50}")
        print(f"[1단계] '{law_name}' 데이터 수집 시작")
        print(f"{'='*50}")

        async with LawAPIClient() as client:
            # 1-1. 법령 검색
            print(f"  - '{law_name}' 검색 중...")
            search_result = await client.search_laws(
                query=law_name,
                law_type="법률",
                display=10
            )

            # 검색 결과에서 정확한 법령 찾기
            laws = search_result.get("LawSearch", {}).get("law", [])
            target_law = None

            for law in laws:
                # 정확히 일치하는 법령명 찾기
                if law.get("법령명한글") == law_name:
                    target_law = law
                    break

            if not target_law:
                print(f"  - '{law_name}'을 찾을 수 없습니다.")
                return None

            mst = target_law.get("법령일련번호")
            print(f"  - 찾음: {target_law.get('법령명한글')} (MST: {mst})")

            # 1-2. 법령 상세 조회
            print(f"  - 상세 데이터 조회 중...")
            detail = await client.get_law_detail(mst)

            # 1-3. 원본 JSON 저장 (백업)
            backup_path = self.data_dir / f"{law_name}.json"
            with open(backup_path, "w", encoding="utf-8") as f:
                json.dump(detail, f, ensure_ascii=False, indent=2)
            print(f"  - 원본 저장: {backup_path}")

            return detail

    # ==================== 2. 조문 추출 (부모-자식 청킹) ====================

    def _ensure_list(self, data) -> list:
        """단일 dict를 리스트로 변환"""
        if isinstance(data, dict):
            return [data]
        if isinstance(data, list):
            return data
        return []

    def _build_ho_text(self, ho: Dict[str, Any]) -> str:
        """호 + 하위 목을 합친 텍스트 생성"""
        text = ho.get("호내용", "")
        moks = self._ensure_list(ho.get("목", []))
        for mok in moks:
            if isinstance(mok, dict):
                mok_content = mok.get("목내용", "")
                if mok_content:
                    text += f"\n  {mok_content}"
        return text

    def _build_full_text(self, article: Dict[str, Any]) -> str:
        """조문 전체 텍스트 생성 (부모용: 조문 + 항 + 호 + 목 전부 합침)"""
        full_content = article.get("조문내용", "")
        paragraphs = self._ensure_list(article.get("항", []))

        for para in paragraphs:
            if not isinstance(para, dict):
                continue
            para_content = para.get("항내용", "")
            if para_content:
                full_content += f"\n{para_content}"

            hos = self._ensure_list(para.get("호", []))
            for ho in hos:
                if not isinstance(ho, dict):
                    continue
                ho_text = self._build_ho_text(ho)
                if ho_text:
                    full_content += f"\n{ho_text}"

        return full_content.strip()

    def extract_chunks(self, law_data: Dict[str, Any], law_name: str) -> Dict[str, List[Dict[str, Any]]]:
        """
        법령 데이터에서 부모/자식 청크 추출

        Args:
            law_data: API에서 받은 법령 데이터
            law_name: 법령명

        Returns:
            {"parents": [...], "children": [...]}
        """
        print(f"\n[2단계] 부모-자식 청크 추출 중...")

        parents = []
        children = []

        law_service = law_data.get("법령", {})
        article_list = self._ensure_list(law_service.get("조문", {}).get("조문단위", []))

        for article in article_list:
            article_num = article.get("조문번호", "")
            article_title = article.get("조문제목", "")
            article_content = article.get("조문내용", "")

            if not article_content:
                continue

            # --- 부모 청크: 조문 전체 합본 ---
            full_text = self._build_full_text(article)
            parent_id_string = f"law_parent_{law_name}_{article_num}"
            parent_hash = hashlib.md5(parent_id_string.encode()).hexdigest()[:16]
            parent_point_id = int(parent_hash, 16)

            parents.append({
                "law_name": law_name,
                "article_number": article_num,
                "article_title": article_title,
                "content": full_text,
                "point_type": "parent",
                "point_id": parent_point_id,
                "id_string": parent_id_string,
            })

            # --- 자식 청크 추출 ---
            parent_context = f"{law_name} 제{article_num}조({article_title})"
            child_index = 0
            paragraphs = self._ensure_list(article.get("항", []))

            for para in paragraphs:
                if not isinstance(para, dict):
                    continue

                hos = self._ensure_list(para.get("호", []))

                if hos:
                    # 호가 있으면: 호 단위로 자식 생성
                    for ho in hos:
                        if not isinstance(ho, dict):
                            continue
                        ho_text = self._build_ho_text(ho)
                        if not ho_text:
                            continue

                        child_id_string = f"law_child_{law_name}_{article_num}_{child_index}"
                        child_hash = hashlib.md5(child_id_string.encode()).hexdigest()[:16]

                        children.append({
                            "law_name": law_name,
                            "article_number": article_num,
                            "article_title": article_title,
                            "content": ho_text.strip(),
                            "embed_text": f"{parent_context} > {ho_text.strip()}",
                            "point_type": "child",
                            "point_id": int(child_hash, 16),
                            "parent_id": parent_point_id,
                            "child_index": child_index,
                            "id_string": child_id_string,
                        })
                        child_index += 1
                else:
                    # 호가 없으면: 항 단위로 자식 생성
                    para_content = para.get("항내용", "")
                    if not para_content:
                        continue

                    child_id_string = f"law_child_{law_name}_{article_num}_{child_index}"
                    child_hash = hashlib.md5(child_id_string.encode()).hexdigest()[:16]

                    children.append({
                        "law_name": law_name,
                        "article_number": article_num,
                        "article_title": article_title,
                        "content": para_content.strip(),
                        "embed_text": f"{parent_context} > {para_content.strip()}",
                        "point_type": "child",
                        "point_id": int(child_hash, 16),
                        "parent_id": parent_point_id,
                        "child_index": child_index,
                        "id_string": child_id_string,
                    })
                    child_index += 1

        print(f"  - 부모 청크: {len(parents)}개 (조문 단위)")
        print(f"  - 자식 청크: {len(children)}개 (호/항 단위)")
        print(f"  - 총 청크: {len(parents) + len(children)}개")
        return {"parents": parents, "children": children}

    # ==================== 3. 임베딩 생성 ====================

    def create_embeddings(self, chunks: List[Dict[str, Any]], label: str = "") -> List[Dict[str, Any]]:
        """
        청크 텍스트를 벡터로 변환

        Args:
            chunks: 부모 또는 자식 청크 리스트
            label: 로그용 라벨 (예: "부모", "자식")

        Returns:
            벡터가 추가된 청크 리스트
        """
        if not chunks:
            return []

        print(f"\n[3단계] {label} 임베딩 생성 중... ({len(chunks)}개)")

        results = []
        batch_size = 20

        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]

            # 임베딩할 텍스트 준비
            # 자식: embed_text (부모 맥락 포함), 부모: 법령명 + 조번호 + 내용
            texts = []
            for chunk in batch:
                if "embed_text" in chunk:
                    texts.append(chunk["embed_text"])
                else:
                    texts.append(
                        f"{chunk['law_name']} 제{chunk['article_number']}조 {chunk['article_title']}\n{chunk['content']}"
                    )

            response = self.openai_client.embeddings.create(
                model="text-embedding-3-small",
                input=texts
            )

            for j, chunk in enumerate(batch):
                chunk_with_vector = chunk.copy()
                chunk_with_vector["vector"] = response.data[j].embedding
                results.append(chunk_with_vector)

            print(f"  - {label} 진행: {min(i + batch_size, len(chunks))}/{len(chunks)}")
            time.sleep(1)

        print(f"  - {label} 임베딩 완료: {len(results)}개")
        return results

    # ==================== 4. Qdrant 저장 ====================

    def save_to_qdrant(self, chunks_with_vectors: List[Dict[str, Any]], label: str = "") -> int:
        """
        벡터 데이터를 Qdrant에 저장

        Args:
            chunks_with_vectors: 벡터가 포함된 청크 리스트
            label: 로그용 라벨

        Returns:
            저장된 개수
        """
        if not chunks_with_vectors:
            return 0

        print(f"\n[4단계] {label} Qdrant에 저장 중... ({len(chunks_with_vectors)}개)")

        points = []
        for chunk in chunks_with_vectors:
            payload = {
                "law_name": chunk["law_name"],
                "article_number": chunk["article_number"],
                "article_title": chunk["article_title"],
                "content": chunk["content"],
                "type": "law",
                "point_type": chunk["point_type"],
                "id_string": chunk["id_string"],
            }

            # 자식 전용 필드
            if chunk["point_type"] == "child":
                payload["parent_id"] = chunk["parent_id"]
                payload["child_index"] = chunk["child_index"]

            points.append({
                "id": chunk["point_id"],
                "vector": chunk["vector"],
                "payload": payload,
            })

        saved = self.qdrant_service.upsert_batch(
            collection_name=QdrantService.LAWS_COLLECTION,
            points=points,
            batch_size=100
        )

        print(f"  - {label} 저장 완료: {saved}개")
        return saved

    # ==================== 메인 실행 ====================

    async def collect_all(self):
        """모든 대상 법령 수집 (부모-자식 청킹)"""
        print("\n" + "=" * 60)
        print("법령 데이터 수집 시작 (부모-자식 청킹)")
        print(f"대상: {', '.join(self.TARGET_LAWS)}")
        print("=" * 60)

        # Qdrant 연결 확인
        if not self.qdrant_service.check_connection():
            print("Qdrant 서버에 연결할 수 없습니다.")
            return

        # laws 컬렉션이 없으면 생성
        if not self.qdrant_service.create_collection(QdrantService.LAWS_COLLECTION):
            print("laws 컬렉션 생성에 실패했습니다.")
            return

        total_parents = 0
        total_children = 0

        for law_name in self.TARGET_LAWS:
            try:
                # 1. 데이터 수집
                law_data = await self.fetch_law_data(law_name)
                if not law_data:
                    continue

                # 2. 부모-자식 청크 추출
                chunks = self.extract_chunks(law_data, law_name)
                if not chunks["parents"]:
                    print(f"  - '{law_name}'에서 조문을 추출할 수 없습니다.")
                    continue

                # 3. 임베딩 생성 (부모/자식 각각)
                parents_with_vectors = self.create_embeddings(chunks["parents"], label="부모")
                children_with_vectors = self.create_embeddings(chunks["children"], label="자식")

                # 4. Qdrant 저장 (부모/자식 각각)
                saved_parents = self.save_to_qdrant(parents_with_vectors, label="부모")
                saved_children = self.save_to_qdrant(children_with_vectors, label="자식")

                total_parents += saved_parents
                total_children += saved_children

            except Exception as e:
                print(f"  - '{law_name}' 처리 중 에러: {e}")
                import traceback
                traceback.print_exc()
                continue

        # 결과 출력
        print("\n" + "=" * 60)
        print("수집 완료!")
        print(f"부모 청크 (조문 단위): {total_parents}개")
        print(f"자식 청크 (호/항 단위): {total_children}개")
        print(f"총 저장: {total_parents + total_children}개")

        # 컬렉션 상태 확인
        info = self.qdrant_service.get_collection_info(QdrantService.LAWS_COLLECTION)
        if info:
            print(f"laws 컬렉션 현재 상태: {info}")
        print("=" * 60)


async def main():
    collector = LawCollector()
    await collector.collect_all()


if __name__ == "__main__":
    asyncio.run(main())
