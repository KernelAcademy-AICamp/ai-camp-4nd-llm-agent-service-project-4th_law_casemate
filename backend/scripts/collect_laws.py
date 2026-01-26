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

from app.services.law_api_service import LawAPIClient
from app.services.qdrant_service import QdrantService

load_dotenv()


class LawCollector:
    """법령 데이터 수집기"""

    # 수집할 법령 목록
    #TARGET_LAWS = ["민법", "형법", "근로기준법", "노동위원회법", "정보통신망 이용촉진 및 정보보호 등에 관한 법률", "언론중재 및 피해구제 등에 관한 법률", "개인정보 보호법"]
    TARGET_LAWS = ["남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률"]

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

    # ==================== 2. 조문 추출 및 청킹 ====================

    def extract_articles(self, law_data: Dict[str, Any], law_name: str) -> List[Dict[str, Any]]:
        """
        법령 데이터에서 조문 추출

        Args:
            law_data: API에서 받은 법령 데이터
            law_name: 법령명

        Returns:
            조문 리스트
        """
        print(f"\n[2단계] 조문 추출 중...")

        articles = []

        # JSON 구조에서 조문 찾기
        law_service = law_data.get("법령", {})

        # 조문 정보 추출
        article_list = law_service.get("조문", {}).get("조문단위", [])

        # 단일 조문인 경우 리스트로 변환
        if isinstance(article_list, dict):
            article_list = [article_list]

        for article in article_list:
            article_num = article.get("조문번호", "")
            article_title = article.get("조문제목", "")
            article_content = article.get("조문내용", "")

            # 조문 내용이 있는 경우만 추가
            if article_content:
                # 항 정보가 있으면 합치기
                paragraphs = article.get("항", [])
                if isinstance(paragraphs, dict):
                    paragraphs = [paragraphs]

                full_content = article_content
                for para in paragraphs:
                    if isinstance(para, dict):
                        para_content = para.get("항내용", "")
                        if para_content:
                            full_content += f"\n{para_content}"

                articles.append({
                    "law_name": law_name,
                    "article_number": article_num,
                    "article_title": article_title,
                    "content": full_content.strip(),
                })

        print(f"  - 추출된 조문 수: {len(articles)}개")
        return articles

    # ==================== 3. 임베딩 생성 ====================

    def create_embeddings(self, articles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        조문 텍스트를 벡터로 변환

        Args:
            articles: 조문 리스트

        Returns:
            벡터가 추가된 조문 리스트
        """
        print(f"\n[3단계] 임베딩 생성 중...")

        results = []
        batch_size = 20  # OpenAI API 배치 크기

        for i in range(0, len(articles), batch_size):
            batch = articles[i:i + batch_size]

            # 임베딩할 텍스트 준비
            texts = [
                f"{a['law_name']} {a['article_number']} {a['article_title']}\n{a['content']}"
                for a in batch
            ]

            # OpenAI 임베딩 API 호출
            response = self.openai_client.embeddings.create(
                model="text-embedding-3-small",
                input=texts
            )

            # 결과 매핑
            for j, article in enumerate(batch):
                article_with_vector = article.copy()
                article_with_vector["vector"] = response.data[j].embedding
                results.append(article_with_vector)

            print(f"  - 진행: {min(i + batch_size, len(articles))}/{len(articles)}")

            # Rate Limit 방지: 배치 사이 1초 대기
            time.sleep(1)

        print(f"  - 임베딩 생성 완료: {len(results)}개")
        return results

    # ==================== 4. Qdrant 저장 ====================

    def save_to_qdrant(self, articles_with_vectors: List[Dict[str, Any]]) -> int:
        """
        벡터 데이터를 Qdrant에 저장

        Args:
            articles_with_vectors: 벡터가 포함된 조문 리스트

        Returns:
            저장된 개수
        """
        print(f"\n[4단계] Qdrant에 저장 중...")

        points = []
        for article in articles_with_vectors:
            # 고유 ID 생성 (해시값 사용 - Qdrant는 정수 또는 UUID만 허용)
            id_string = f"law_{article['law_name']}_{article['article_number']}"
            # MD5 해시의 앞 16자리를 정수로 변환
            hash_hex = hashlib.md5(id_string.encode()).hexdigest()[:16]
            point_id = int(hash_hex, 16)

            points.append({
                "id": point_id,
                "vector": article["vector"],
                "payload": {
                    "law_name": article["law_name"],
                    "article_number": article["article_number"],
                    "article_title": article["article_title"],
                    "content": article["content"],
                    "type": "law",
                    "id_string": id_string,  # 원본 ID 문자열도 payload에 저장
                }
            })

        # 배치 저장
        saved = self.qdrant_service.upsert_batch(
            collection_name=QdrantService.LAWS_COLLECTION,
            points=points,
            batch_size=100
        )

        print(f"  - 저장 완료: {saved}개")
        return saved

    # ==================== 메인 실행 ====================

    async def collect_all(self):
        """모든 대상 법령 수집"""
        print("\n" + "=" * 60)
        print("법령 데이터 수집 시작")
        print(f"대상: {', '.join(self.TARGET_LAWS)}")
        print("=" * 60)

        # Qdrant 연결 확인
        if not self.qdrant_service.check_connection():
            print("Qdrant 서버에 연결할 수 없습니다.")
            return

        total_saved = 0

        for law_name in self.TARGET_LAWS:
            try:
                # 1. 데이터 수집
                law_data = await self.fetch_law_data(law_name)
                if not law_data:
                    continue

                # 2. 조문 추출
                articles = self.extract_articles(law_data, law_name)
                if not articles:
                    print(f"  - '{law_name}'에서 조문을 추출할 수 없습니다.")
                    continue

                # 3. 임베딩 생성
                articles_with_vectors = self.create_embeddings(articles)

                # 4. Qdrant 저장
                saved = self.save_to_qdrant(articles_with_vectors)
                total_saved += saved

            except Exception as e:
                print(f"  - '{law_name}' 처리 중 에러: {e}")
                import traceback
                traceback.print_exc()
                continue

        # 결과 출력
        print("\n" + "=" * 60)
        print("수집 완료!")
        print(f"총 저장된 조문 수: {total_saved}개")

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
