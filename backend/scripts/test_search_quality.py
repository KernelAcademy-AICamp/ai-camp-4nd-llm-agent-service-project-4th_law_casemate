"""
검색 품질 테스트 스크립트
대표 질의로 threshold/limit 조합을 평가하고 최적 파라미터를 찾습니다.
"""

import os
import sys
from pathlib import Path
from typing import List, Dict, Any
from dataclasses import dataclass
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from qdrant_client import QdrantClient
from qdrant_client.http import models
from openai import OpenAI
from fastembed import SparseTextEmbedding

load_dotenv()

# 설정
QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))

# 대표 질의 (20개) - 실제 법률 상담 시나리오 기반
TEST_QUERIES = [
    # 명예훼손/모욕 (4개)
    ("명예훼손", "인터넷 커뮤니티에 허위 사실을 게시하여 타인의 명예를 훼손한 경우"),
    ("모욕죄", "공개된 장소에서 욕설과 비하 발언으로 상대방을 모욕한 경우"),
    ("사이버 명예훼손", "SNS에서 특정인에 대한 비방글을 작성하여 유포한 경우"),
    ("언론 피해", "언론 보도로 인해 명예가 훼손되어 정정보도를 요청하는 경우"),

    # 개인정보/정보통신 (4개)
    ("개인정보 유출", "회사가 고객 개인정보를 동의 없이 제3자에게 제공한 경우"),
    ("온라인 유포", "타인의 사진을 동의 없이 인터넷에 게시한 경우"),
    ("해킹 피해", "정보통신망에 불법 침입하여 개인정보를 탈취한 경우"),
    ("스팸 문자", "동의 없이 영리목적의 광고성 정보를 전송한 경우"),

    # 근로/노동 (4개)
    ("부당해고", "정당한 사유 없이 근로자를 해고한 경우"),
    ("직장 내 괴롭힘", "상사가 지속적으로 업무 외적인 일을 강요하고 폭언을 한 경우"),
    ("직장 내 성희롱", "직장에서 성적 언동으로 불쾌감을 주는 행위가 발생한 경우"),
    ("임금 체불", "근로자에게 정당한 임금을 지급하지 않은 경우"),

    # 민사 일반 (4개)
    ("손해배상 청구", "타인의 불법행위로 인해 재산상 손해가 발생한 경우"),
    ("계약 위반", "계약 당사자가 계약 내용을 이행하지 않은 경우"),
    ("채무 불이행", "금전 채무를 이행하지 않아 소송을 제기하는 경우"),
    ("위자료 청구", "정신적 고통에 대한 배상을 청구하는 경우"),

    # 형사 일반 (4개)
    ("사기죄", "타인을 기망하여 재물을 편취한 경우"),
    ("횡령죄", "업무상 보관하던 타인의 재물을 횡령한 경우"),
    ("폭행죄", "타인에게 물리적 폭력을 행사한 경우"),
    ("협박죄", "해악을 고지하여 타인을 협박한 경우"),
]


@dataclass
class SearchResult:
    law_name: str
    article_number: str
    article_title: str
    content: str
    score: float
    point_type: str
    law_role: str
    parent_id: int = None


class SearchTester:
    def __init__(self):
        self.qdrant = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
        self.openai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.sparse_model = SparseTextEmbedding(model_name="Qdrant/bm25")

    def create_embeddings(self, text: str):
        """Dense + Sparse 임베딩 생성"""
        # Dense
        response = self.openai.embeddings.create(
            model="text-embedding-3-small",
            input=text
        )
        dense = response.data[0].embedding

        # Sparse
        sparse_emb = list(self.sparse_model.embed([text]))[0]
        sparse = models.SparseVector(
            indices=sparse_emb.indices.tolist(),
            values=sparse_emb.values.tolist(),
        )

        return dense, sparse

    def search_hybrid(
        self,
        query: str,
        limit: int = 10,
        point_type_filter: str = None,  # "child", "parent", or None
        law_role_filter: str = None,    # "substance", "procedure", or None
    ) -> List[SearchResult]:
        """하이브리드 검색"""
        dense, sparse = self.create_embeddings(query)

        # 필터 구성
        filter_conditions = []
        if point_type_filter:
            filter_conditions.append(
                models.FieldCondition(
                    key="point_type",
                    match=models.MatchValue(value=point_type_filter)
                )
            )
        if law_role_filter:
            filter_conditions.append(
                models.FieldCondition(
                    key="law_role",
                    match=models.MatchValue(value=law_role_filter)
                )
            )

        query_filter = None
        if filter_conditions:
            query_filter = models.Filter(must=filter_conditions)

        results = self.qdrant.query_points(
            collection_name="laws_hybrid",
            prefetch=[
                models.Prefetch(query=dense, using="dense", limit=limit * 3),
                models.Prefetch(query=sparse, using="sparse", limit=limit * 3),
            ],
            query=models.FusionQuery(fusion=models.Fusion.RRF),
            query_filter=query_filter,
            limit=limit * 2,  # 중복 제거 위해 더 많이 가져옴
        )

        search_results = []
        for r in results.points:
            p = r.payload
            search_results.append(SearchResult(
                law_name=p.get("law_name", ""),
                article_number=p.get("article_number", ""),
                article_title=p.get("article_title", ""),
                content=p.get("content", ""),
                score=r.score,
                point_type=p.get("point_type", ""),
                law_role=p.get("law_role", ""),
                parent_id=p.get("parent_id"),
            ))

        return search_results

    def deduplicate_by_parent(
        self,
        results: List[SearchResult],
        max_per_parent: int = 2,
        limit: int = 10,
    ) -> List[SearchResult]:
        """
        동일 Parent에서 과도한 Child 중복 방지
        - 같은 조문(Parent)에서 최대 max_per_parent개만 유지
        - Child 우선, 점수 높은 순
        """
        # Parent별 그룹화
        parent_groups = defaultdict(list)
        parent_items = []  # Parent 타입 결과

        for r in results:
            if r.point_type == "child":
                key = (r.law_name, r.article_number)
                parent_groups[key].append(r)
            else:
                parent_items.append(r)

        # 각 Parent에서 상위 N개만 선택
        deduplicated = []
        for key, children in parent_groups.items():
            # 점수 높은 순 정렬
            children.sort(key=lambda x: x.score, reverse=True)
            deduplicated.extend(children[:max_per_parent])

        # Parent 타입도 추가 (Child가 없는 단일 조문)
        seen_articles = {(r.law_name, r.article_number) for r in deduplicated}
        for p in parent_items:
            if (p.law_name, p.article_number) not in seen_articles:
                deduplicated.append(p)

        # 최종 점수순 정렬 후 limit 적용
        deduplicated.sort(key=lambda x: x.score, reverse=True)
        return deduplicated[:limit]

    def evaluate_query(
        self,
        name: str,
        query: str,
        limit: int = 10,
        use_dedup: bool = True,
        point_type_filter: str = None,
        law_role_filter: str = None,
    ) -> Dict[str, Any]:
        """단일 질의 평가"""
        results = self.search_hybrid(
            query,
            limit=limit * 2 if use_dedup else limit,
            point_type_filter=point_type_filter,
            law_role_filter=law_role_filter,
        )

        if use_dedup:
            results = self.deduplicate_by_parent(results, max_per_parent=2, limit=limit)
        else:
            results = results[:limit]

        # 통계
        unique_laws = set(r.law_name for r in results)
        unique_articles = set((r.law_name, r.article_number) for r in results)
        child_count = sum(1 for r in results if r.point_type == "child")
        parent_count = sum(1 for r in results if r.point_type == "parent")
        substance_count = sum(1 for r in results if r.law_role == "substance")
        procedure_count = sum(1 for r in results if r.law_role == "procedure")

        return {
            "name": name,
            "query": query[:50] + "...",
            "result_count": len(results),
            "unique_laws": len(unique_laws),
            "unique_articles": len(unique_articles),
            "child_ratio": child_count / len(results) if results else 0,
            "substance_count": substance_count,
            "procedure_count": procedure_count,
            "top_score": results[0].score if results else 0,
            "min_score": results[-1].score if results else 0,
            "results": results,
        }


def run_comparison_test():
    """Before/After 비교 테스트"""
    tester = SearchTester()

    print("=" * 80)
    print("검색 품질 테스트 시작")
    print("=" * 80)

    # 테스트 설정
    test_configs = [
        {"name": "Before (기본)", "limit": 10, "use_dedup": False},
        {"name": "After (중복제거)", "limit": 10, "use_dedup": True},
        {"name": "After (limit=8)", "limit": 8, "use_dedup": True},
        {"name": "After (limit=6)", "limit": 6, "use_dedup": True},
    ]

    all_results = {config["name"]: [] for config in test_configs}

    print(f"\n총 {len(TEST_QUERIES)}개 질의 테스트 중...")

    for i, (name, query) in enumerate(TEST_QUERIES):
        print(f"  [{i+1}/{len(TEST_QUERIES)}] {name}")

        for config in test_configs:
            result = tester.evaluate_query(
                name=name,
                query=query,
                limit=config["limit"],
                use_dedup=config["use_dedup"],
            )
            all_results[config["name"]].append(result)

    # 결과 요약
    print("\n" + "=" * 80)
    print("테스트 결과 요약")
    print("=" * 80)

    for config_name, results in all_results.items():
        avg_unique_laws = sum(r["unique_laws"] for r in results) / len(results)
        avg_unique_articles = sum(r["unique_articles"] for r in results) / len(results)
        avg_child_ratio = sum(r["child_ratio"] for r in results) / len(results)
        avg_top_score = sum(r["top_score"] for r in results) / len(results)
        avg_min_score = sum(r["min_score"] for r in results) / len(results)

        print(f"\n[{config_name}]")
        print(f"  평균 고유 법령 수: {avg_unique_laws:.1f}개")
        print(f"  평균 고유 조문 수: {avg_unique_articles:.1f}개")
        print(f"  Child 비율: {avg_child_ratio:.1%}")
        print(f"  평균 최고 점수: {avg_top_score:.4f}")
        print(f"  평균 최저 점수: {avg_min_score:.4f}")

    # 상세 비교 (샘플 3개)
    print("\n" + "=" * 80)
    print("샘플 질의 상세 비교 (Before vs After)")
    print("=" * 80)

    sample_indices = [0, 4, 8]  # 명예훼손, 개인정보 유출, 부당해고

    for idx in sample_indices:
        name, query = TEST_QUERIES[idx]
        print(f"\n[{name}] {query[:40]}...")

        before = all_results["Before (기본)"][idx]
        after = all_results["After (중복제거)"][idx]

        print(f"\n  Before (중복제거 없음):")
        for i, r in enumerate(before["results"][:5], 1):
            print(f"    {i}. {r.law_name} 제{r.article_number}조 [{r.point_type}] (score: {r.score:.4f})")

        print(f"\n  After (중복제거 적용):")
        for i, r in enumerate(after["results"][:5], 1):
            print(f"    {i}. {r.law_name} 제{r.article_number}조 [{r.point_type}] (score: {r.score:.4f})")

    return all_results


def find_optimal_limit():
    """최적 limit 탐색"""
    tester = SearchTester()

    print("\n" + "=" * 80)
    print("최적 limit 탐색 (5, 6, 8, 10)")
    print("=" * 80)

    limits = [5, 6, 8, 10]

    for limit in limits:
        total_unique_laws = 0
        total_unique_articles = 0

        for name, query in TEST_QUERIES[:10]:  # 상위 10개만 빠르게
            result = tester.evaluate_query(
                name=name,
                query=query,
                limit=limit,
                use_dedup=True,
            )
            total_unique_laws += result["unique_laws"]
            total_unique_articles += result["unique_articles"]

        avg_laws = total_unique_laws / 10
        avg_articles = total_unique_articles / 10

        print(f"  limit={limit}: 평균 {avg_laws:.1f}개 법령, {avg_articles:.1f}개 조문")


if __name__ == "__main__":
    results = run_comparison_test()
    find_optimal_limit()
