"""
에이전트 도구 정의 — 기존 백엔드 서비스를 @tool로 래핑

create_tools(user_id, law_firm_id)를 호출하면
해당 사용자 전용 도구 세트(10개)를 반환한다.

반환 형식: JSON 문자열 {"text": "LLM용 마크다운", "data": 구조화 데이터}
"""

import json
import re
import logging
from langchain_core.tools import tool
from tool.database import SessionLocal
from app.models.evidence import Case, CaseAnalysis, CaseEvidenceMapping

logger = logging.getLogger(__name__)


def _structured_return(text: str, data) -> str:
    """LLM용 텍스트 + 프론트 리치 렌더링용 구조화 데이터를 JSON 문자열로 반환"""
    return json.dumps({"text": text, "data": data}, ensure_ascii=False)


def create_tools(user_id: int, law_firm_id: int):
    """사용자별 도구 세트 생성 (클로저로 user_id/law_firm_id 캡처)"""

    @tool
    def list_cases(search_query: str = "") -> str:
        """사용자의 사건 목록을 조회합니다.

        사건 ID, 제목, 의뢰인, 상대방, 사건 유형, 상태, 증거 수, 분석 여부, 등록일(created_at)을 반환합니다.
        사건 분석이나 타임라인 생성 전에 어떤 사건이 있는지 확인할 때 사용하세요.
        증거 유무, 분석 여부, 등록일 기준 질문(이번 달/이번 주 등록된 사건, 가장 최근 사건 등)도 이 결과만으로 답할 수 있습니다.

        Args:
            search_query: 검색어 (의뢰인명, 상대방명, 사건 제목에서 검색). 빈 문자열이면 전체 조회.
        """
        try:
            from sqlalchemy import func as sa_func, text as sql_text

            with SessionLocal() as db:
                # 사건별 증거 수 서브쿼리
                evidence_count_sq = (
                    db.query(
                        CaseEvidenceMapping.case_id,
                        sa_func.count(CaseEvidenceMapping.evidence_id).label("evidence_count"),
                    )
                    .group_by(CaseEvidenceMapping.case_id)
                    .subquery()
                )
                # 사건별 분석 존재 여부 서브쿼리
                analysis_sq = (
                    db.query(CaseAnalysis.case_id)
                    .filter(CaseAnalysis.summary.isnot(None))
                    .subquery()
                )

                from sqlalchemy import or_

                query = (
                    db.query(
                        Case,
                        sa_func.coalesce(evidence_count_sq.c.evidence_count, 0).label("evidence_count"),
                        analysis_sq.c.case_id.label("has_analysis_id"),
                    )
                    .outerjoin(evidence_count_sq, Case.id == evidence_count_sq.c.case_id)
                    .outerjoin(analysis_sq, Case.id == analysis_sq.c.case_id)
                    .filter(
                        Case.law_firm_id == law_firm_id,
                        Case.availability == "o",
                    )
                )

                # 검색어가 있으면 의뢰인/상대방/제목에서 필터링 (단어별 OR)
                if search_query and search_query.strip():
                    conditions = []
                    for word in search_query.strip().split():
                        if len(word) >= 2:
                            term = f"%{word}%"
                            conditions.extend([
                                Case.client_name.ilike(term),
                                Case.opponent_name.ilike(term),
                                Case.title.ilike(term),
                            ])
                    if conditions:
                        query = query.filter(or_(*conditions))

                rows = query.order_by(Case.created_at.desc()).limit(20).all()
                if not rows:
                    if search_query and search_query.strip():
                        return _structured_return(f"'{search_query}'에 해당하는 사건을 찾지 못했습니다.", [])
                    return _structured_return("등록된 사건이 없습니다.", [])

                data = []
                lines = []
                for c, ev_count, has_analysis_id in rows:
                    has_analysis = has_analysis_id is not None
                    created_str = c.created_at.strftime("%Y-%m-%d") if c.created_at else "미지정"
                    data.append({
                        "id": c.id,
                        "title": c.title,
                        "client_name": c.client_name or "미지정",
                        "opponent_name": c.opponent_name or "미지정",
                        "case_type": c.case_type or "미지정",
                        "status": c.status or "미지정",
                        "evidence_count": ev_count,
                        "has_analysis": has_analysis,
                        "created_at": created_str,
                    })
                    analysis_mark = "분석완료" if has_analysis else "미분석"
                    lines.append(
                        f"- [사건 #{c.id}] {c.title}"
                        f" | 의뢰인: {c.client_name or '미지정'}"
                        f" | 상대방: {c.opponent_name or '미지정'}"
                        f" | 유형: {c.case_type or '미지정'}"
                        f" | 상태: {c.status or '미지정'}"
                        f" | 증거: {ev_count}건"
                        f" | {analysis_mark}"
                        f" | 등록: {created_str}"
                    )
                text = f"총 {len(rows)}건의 사건:\n" + "\n".join(lines)
                return _structured_return(text, data)
        except Exception as e:
            logger.error(f"사건 목록 조회 실패: {e}", exc_info=True)
            return _structured_return(f"사건 목록 조회 실패: {e}", None)

    @tool
    def analyze_case(case_id: int) -> str:
        """사건의 AI 분석 결과를 조회합니다. 요약, 사실관계, 주장사항, 관련 법률을 반환합니다.

        Args:
            case_id: 분석할 사건 ID (list_cases로 확인 가능)

        주의: 타임라인 생성, 관계도 생성 전에 반드시 이 도구를 먼저 호출하세요.
        이미 분석된 사건이면 캐시된 결과를 즉시 반환합니다.
        아직 분석되지 않은 사건이면 안내 메시지를 반환합니다.
        """
        try:
            with SessionLocal() as db:
                case = db.query(Case).filter(Case.id == case_id, Case.law_firm_id == law_firm_id).first()
                if not case:
                    return _structured_return(f"사건 #{case_id}을 찾을 수 없습니다.", None)

                analysis = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case_id).first()
                if not analysis or not analysis.summary:
                    return _structured_return(
                        f"사건 #{case_id}({case.title})은 아직 분석되지 않았습니다.\n"
                        f"사건 페이지에서 '분석' 버튼을 눌러 분석을 먼저 실행해주세요.",
                        None,
                    )

                crime_names = json.loads(analysis.crime_names) if analysis.crime_names else []
                keywords = json.loads(analysis.legal_keywords) if analysis.legal_keywords else []

                text = (
                    f"## 사건 분석 결과 (#{case_id}: {case.title})\n\n"
                    f"### 요약\n{analysis.summary}\n\n"
                    f"### 사실관계\n{analysis.facts or '없음'}\n\n"
                    f"### 주장사항\n{analysis.claims or '없음'}\n\n"
                    f"### 관련 범죄\n{', '.join(crime_names)}\n"
                    f"### 법적 키워드\n{', '.join(keywords)}"
                )
                data = {
                    "summary": analysis.summary,
                    "facts": analysis.facts or "없음",
                    "claims": analysis.claims or "없음",
                    "crime_names": crime_names,
                    "legal_keywords": keywords,
                }
                return _structured_return(text, data)
        except Exception as e:
            logger.error(f"사건 분석 조회 실패: {e}", exc_info=True)
            return _structured_return(f"사건 분석 조회 실패: {e}", None)

    @tool
    async def generate_timeline(case_id: int) -> str:
        """사건의 타임라인(시간순 사건 흐름)을 생성합니다.

        Args:
            case_id: 사건 ID

        주의: analyze_case가 먼저 완료되어야 합니다.
        """
        try:
            from app.services.timeline_service import TimeLineService

            with SessionLocal() as db:
                case = db.query(Case).filter(Case.id == case_id, Case.law_firm_id == law_firm_id).first()
                if not case:
                    return _structured_return(f"사건 #{case_id}을 찾을 수 없습니다.", None)

                service = TimeLineService(db, case_id)
                timelines = await service.generate_timeline_auto()

                if not timelines:
                    return _structured_return(
                        "타임라인을 생성할 수 없습니다. 사건 분석을 먼저 실행해주세요.",
                        [],
                    )

                data = []
                lines = []
                for t in timelines:
                    data.append({
                        "date": str(t.date) if t.date else None,
                        "title": t.title,
                        "description": t.description,
                        "type": getattr(t, "event_type", None) or getattr(t, "type", None),
                        "actor": getattr(t, "actor", None),
                    })
                    lines.append(f"- [{t.date}] {t.title}: {t.description}")
                text = f"## 타임라인 (#{case_id})\n\n" + "\n".join(lines)
                return _structured_return(text, data)
        except Exception as e:
            logger.error(f"타임라인 생성 실패: {e}", exc_info=True)
            return _structured_return(f"타임라인 생성 실패: {e}", None)

    @tool
    async def generate_relationship(case_id: int) -> str:
        """사건 관계자들의 관계도를 생성합니다.

        Args:
            case_id: 사건 ID

        주의: analyze_case가 먼저 완료되어야 합니다.
        """
        try:
            from app.services.relationship_service import RelationshipService

            with SessionLocal() as db:
                case = db.query(Case).filter(Case.id == case_id, Case.law_firm_id == law_firm_id).first()
                if not case:
                    return _structured_return(f"사건 #{case_id}을 찾을 수 없습니다.", None)

                service = RelationshipService(db, case_id)
                result = await service.generate_relationship()

                persons = result.get("persons", [])
                rels = result.get("relationships", [])

                if not persons:
                    return _structured_return(
                        "관계도를 생성할 수 없습니다. 사건 분석을 먼저 실행해주세요.",
                        {"persons": [], "relationships": []},
                    )

                lines = ["## 관계도\n", "### 인물"]
                for p in persons:
                    lines.append(f"- {p.get('name', '?')} ({p.get('role', '?')}): {p.get('description', '')}")
                lines.append("\n### 관계")
                for r in rels:
                    lines.append(f"- {r.get('label', '?')} ({r.get('relationship_type', '?')})")

                text = "\n".join(lines)
                data = {"persons": persons, "relationships": rels}
                return _structured_return(text, data)
        except Exception as e:
            logger.error(f"관계도 생성 실패: {e}", exc_info=True)
            return _structured_return(f"관계도 생성 실패: {e}", None)

    @tool
    def search_precedents(query: str, limit: int = 5) -> str:
        """판례만 검색합니다. 사용자가 명시적으로 "판례 찾아줘"라고 요청할 때만 사용하세요.

        주의: 일반 법률 질문(성립 요건, 차이점, 처벌 기준 등)에는 이 도구 대신 rag_search를 사용하세요.

        Args:
            query: 검색 키워드 (예: "사기죄 공소시효", "교통사고 손해배상")
            limit: 반환할 결과 수 (기본값: 5)
        """
        try:
            from app.services.precedent_search_service import PrecedentSearchService

            service = PrecedentSearchService()
            result = service.search_cases(query=query, limit=limit)

            items = result.get("results", [])
            if not items:
                return _structured_return(f"'{query}'에 대한 판례를 찾지 못했습니다.", [])

            data = []
            lines = [f"## 판례 검색 결과 ({len(items)}건)\n"]
            for i, item in enumerate(items, 1):
                # judgment_date를 문자열로 안전하게 변환
                jdate = item.get("judgment_date", "?")
                if hasattr(jdate, "strftime"):
                    jdate = jdate.strftime("%Y-%m-%d")
                elif isinstance(jdate, int):
                    jdate = str(jdate)

                data.append({
                    "case_number": str(item.get("case_number", "?")),
                    "case_name": str(item.get("case_name", "?")),
                    "court": str(item.get("court_name", "?")),
                    "judgment_date": str(jdate),
                    "content_snippet": str((item.get("content", "") or ""))[:500],
                })
                lines.append(
                    f"### {i}. {item.get('case_number', '?')}\n"
                    f"- 사건명: {item.get('case_name', '?')}\n"
                    f"- 법원: {item.get('court_name', '?')}\n"
                    f"- 선고일: {jdate}\n"
                    f"- 내용: {(item.get('content', '') or '')[:500]}\n"
                )
            text = "\n".join(lines)
            return _structured_return(text, data)
        except Exception as e:
            logger.error(f"판례 검색 실패: {e}", exc_info=True)
            return _structured_return(f"판례 검색 실패: {e}", None)

    @tool
    def summarize_precedent(case_number: str, content: str) -> str:
        """특정 판례를 요약합니다.

        Args:
            case_number: 판례 사건번호 (예: "2023다12345")
            content: 판례 내용 텍스트 (search_precedents 결과에서 가져옴)
        """
        try:
            from app.services.precedent_summary_service import SummaryService

            service = SummaryService()
            result = service.get_or_generate_summary(
                case_number=case_number,
                content=content,
            )
            summary = result.get("summary", "요약을 생성할 수 없습니다.")
            text = f"## 판례 요약 ({case_number})\n\n{summary}"
            data = {"case_number": case_number, "summary": summary}
            return _structured_return(text, data)
        except Exception as e:
            logger.error(f"판례 요약 실패: {e}", exc_info=True)
            return _structured_return(f"판례 요약 실패: {e}", None)

    @tool
    def compare_precedent(case_id: int, target_case_number: str) -> str:
        """내 사건과 특정 판례를 비교 분석합니다.

        Args:
            case_id: 비교할 내 사건 ID
            target_case_number: 비교 대상 판례 사건번호

        주의: search_precedents로 먼저 판례를 검색한 후 사용하세요.
        """
        try:
            from app.services.comparison_service import ComparisonService

            with SessionLocal() as db:
                analysis = db.query(CaseAnalysis).filter(CaseAnalysis.case_id == case_id).first()
                if not analysis:
                    return _structured_return("사건 분석이 필요합니다. analyze_case를 먼저 호출하세요.", None)

                service = ComparisonService()
                result = service.compare(
                    origin_facts=analysis.facts or "",
                    origin_claims=analysis.claims or "",
                    target_case_number=target_case_number,
                )

                if not result.get("success"):
                    return _structured_return(
                        f"비교 분석 실패: {result.get('error', '알 수 없는 오류')}",
                        None,
                    )

                parsed = result.get("parsed", {})
                text = (
                    f"## 판례 비교 분석\n\n"
                    f"### 현재 사건 개요\n{parsed.get('case_overview', '')}\n\n"
                    f"### 판례 요약\n{parsed.get('precedent_summary', '')}\n\n"
                    f"### 유사점\n{parsed.get('similarities', '')}\n\n"
                    f"### 차이점\n{parsed.get('differences', '')}\n\n"
                    f"### 전략적 시사점\n{parsed.get('strategy_points', '')}"
                )
                data = {
                    "case_overview": parsed.get("case_overview", ""),
                    "precedent_summary": parsed.get("precedent_summary", ""),
                    "similarities": parsed.get("similarities", ""),
                    "differences": parsed.get("differences", ""),
                    "strategy_points": parsed.get("strategy_points", ""),
                }
                return _structured_return(text, data)
        except Exception as e:
            logger.error(f"판례 비교 실패: {e}", exc_info=True)
            return _structured_return(f"판례 비교 실패: {e}", None)

    @tool
    def search_laws(query: str, limit: int = 8) -> str:
        """법령만 검색합니다. 사용자가 명시적으로 특정 조문을 요청할 때만 사용하세요.

        사용 예시: "형법 제307조 찾아줘", "민법 750조 알려줘"

        주의: 일반 법률 질문(성립 요건, 차이점, 처벌 기준 등)에는 이 도구 대신 rag_search를 사용하세요.

        Args:
            query: 검색 키워드 (예: "형법 제307조", "민법 750조")
            limit: 반환할 결과 수 (기본값: 8)
        """
        try:
            from app.services.search_laws_service import SearchLawsService

            service = SearchLawsService()

            # 특정 조문 패턴 감지: "형법 제307조", "민법 750조" 등
            article_pattern = re.match(
                r'^([가-힣]+(?:법|령|규칙))\s*제?(\d+(?:의\d+)?)\s*조?',
                query.strip()
            )

            if article_pattern:
                # 정확한 조문 조회
                law_name = article_pattern.group(1)
                article_number = article_pattern.group(2)
                logger.info(f"[search_laws] 정확한 조문 조회: {law_name} 제{article_number}조")

                article = service.get_article(law_name, article_number)

                if article:
                    data = [{
                        "law_name": article.get("law_name", law_name),
                        "article_number": article.get("article_number", article_number),
                        "article_title": article.get("article_title", ""),
                        "content": article.get("content", ""),
                    }]
                    text = f"## {law_name} 제{article_number}조 {article.get('article_title', '')}\n\n{article.get('content', '')}"
                    return _structured_return(text, data)
                else:
                    # 정확한 조문 없으면 벡터 검색으로 폴백
                    logger.info(f"[search_laws] 정확한 조문 없음, 벡터 검색으로 폴백")

            # 벡터 검색 (일반 키워드 검색)
            result = service.search_laws(query=query, limit=limit)

            items = result.get("results", [])
            if not items:
                return _structured_return(f"'{query}'에 대한 법령을 찾지 못했습니다.", [])

            data = []
            lines = [f"## 법령 검색 결과 ({len(items)}건)\n"]
            for i, item in enumerate(items, 1):
                data.append({
                    "law_name": item.get("law_name", "?"),
                    "article_number": item.get("article_number", "?"),
                    "article_title": item.get("article_title", ""),
                    "content": (item.get("content", "") or "")[:400],
                })
                lines.append(
                    f"### {i}. {item.get('law_name', '?')} 제{item.get('article_number', '?')}조"
                    f" {item.get('article_title', '')}\n"
                    f"{(item.get('content', '') or '')[:400]}\n"
                )
            text = "\n".join(lines)
            return _structured_return(text, data)
        except Exception as e:
            logger.error(f"법령 검색 실패: {e}", exc_info=True)
            return _structured_return(f"법령 검색 실패: {e}", None)

    @tool
    def get_case_evidence(case_id: int) -> str:
        """사건에 연결된 증거 파일 목록과 분석 현황을 조회합니다.

        Args:
            case_id: 사건 ID

        증거 현황, 파일 목록, 분석 여부를 확인할 때 사용하세요.
        """
        try:
            from sqlalchemy import text as sql_text

            with SessionLocal() as db:
                rows = db.execute(sql_text("""
                    SELECT
                        e.id, e.file_name, e.file_type, e.doc_type, e.starred,
                        e.created_at,
                        cem.evidence_date, cem.description,
                        ea.summary AS analysis_summary,
                        ea.legal_relevance,
                        ea.risk_level
                    FROM case_evidence_mappings cem
                    JOIN evidences e ON e.id = cem.evidence_id
                    LEFT JOIN evidence_analyses ea
                        ON ea.evidence_id = e.id AND ea.case_id = :case_id
                    WHERE cem.case_id = :case_id
                      AND e.law_firm_id = :firm_id
                    ORDER BY cem.created_at DESC
                """), {"case_id": case_id, "firm_id": law_firm_id}).fetchall()

                if not rows:
                    return _structured_return(
                        f"사건(ID: {case_id})에 연결된 증거가 없습니다.",
                        [],
                    )

                data = []
                lines = [f"## 증거 현황 ({len(rows)}건)\n"]
                for r in rows:
                    item = {
                        "id": r.id,
                        "file_name": r.file_name,
                        "file_type": r.file_type or "unknown",
                        "doc_type": r.doc_type or "미분류",
                        "starred": bool(r.starred),
                        "evidence_date": r.evidence_date,
                        "description": r.description,
                        "has_analysis": r.analysis_summary is not None,
                        "analysis_summary": r.analysis_summary,
                        "legal_relevance": r.legal_relevance,
                        "risk_level": r.risk_level,
                    }
                    data.append(item)

                    star = "⭐ " if r.starred else ""
                    risk = f" [{r.risk_level}]" if r.risk_level else ""
                    lines.append(
                        f"### {star}{r.file_name}{risk}\n"
                        f"- 유형: {r.doc_type or '미분류'}\n"
                        f"- 날짜: {r.evidence_date or '미지정'}\n"
                        f"- 설명: {r.description or '없음'}\n"
                        f"- 분석: {'완료' if r.analysis_summary else '미완료'}\n"
                    )
                    if r.analysis_summary:
                        lines.append(f"  - 요약: {r.analysis_summary[:300]}\n")
                    if r.legal_relevance:
                        lines.append(f"  - 법적 관련성: {r.legal_relevance[:300]}\n")

                text_result = "\n".join(lines)
                return _structured_return(text_result, data)
        except Exception as e:
            logger.error(f"증거 현황 조회 실패: {e}", exc_info=True)
            return _structured_return(f"증거 현황 조회 실패: {e}", None)

    @tool
    async def rag_search(query: str, keyword: str = "", precedent_limit: int = 5, law_limit: int = 3) -> str:
        """[기본 검색 도구] 판례와 법령을 병렬로 검색합니다.

        ⚠️ 대부분의 법률 질문에 이 도구를 사용하세요:
        - "~뭐야?", "~나요?", "~어떻게 돼?" 형태의 질문
        - 성립 요건, 차이점, 처벌 기준, 양형 기준 질문
        - 예: "명예훼손죄 성립 요건이 뭐야?", "사기죄와 횡령죄 차이가 뭐야?"

        search_laws, search_precedents는 사용자가 명시적으로 요청할 때만 사용하세요.

        Args:
            query: 사용자 질문 전체
            keyword: 핵심 검색 키워드 (예: "명예훼손죄", "사기죄")
            precedent_limit: 판례 검색 개수 (기본값: 5)
            law_limit: 법령 검색 개수 (기본값: 3)
        """
        try:
            from app.services.rag_service import RAGService

            rag_service = RAGService()
            rag_context = await rag_service.retrieve(
                query=query,
                keyword=keyword if keyword else None,
                sources=["precedent", "law"],
                precedent_limit=precedent_limit,
                law_limit=law_limit
            )

            if not rag_context.sources:
                return _structured_return(
                    f"'{keyword or query}'에 대한 관련 자료를 찾지 못했습니다.",
                    {"precedents": [], "laws": []}
                )

            precedents = []
            laws = []
            lines = ["## RAG 검색 결과\n"]

            for source in rag_context.sources:
                if source.type == "precedent":
                    precedents.append({
                        "case_number": source.id,
                        "case_name": source.title,
                        "court": source.metadata.get("court", ""),
                        "judgment_date": source.metadata.get("date", ""),
                        "content_snippet": source.content[:500],
                    })
                elif source.type == "law":
                    laws.append({
                        "law_name": source.metadata.get("law_name", ""),
                        "article_number": source.metadata.get("article_number", ""),
                        "article_title": source.metadata.get("article_title", ""),
                        "content": source.content[:400],
                    })

            if precedents:
                lines.append(f"### 판례 ({len(precedents)}건)\n")
                for i, p in enumerate(precedents, 1):
                    lines.append(
                        f"**{i}. {p['case_number']}**\n"
                        f"- 사건명: {p['case_name']}\n"
                        f"- 법원: {p['court']} | 선고일: {p['judgment_date']}\n"
                        f"- 내용: {p['content_snippet']}\n"
                    )

            if laws:
                lines.append(f"\n### 법령 ({len(laws)}건)\n")
                for i, law in enumerate(laws, 1):
                    lines.append(
                        f"**{i}. {law['law_name']} 제{law['article_number']}조** {law['article_title']}\n"
                        f"{law['content']}\n"
                    )

            text = "\n".join(lines)
            return _structured_return(text, {"precedents": precedents, "laws": laws})

        except Exception as e:
            logger.error(f"RAG 검색 실패: {e}", exc_info=True)
            return _structured_return(f"RAG 검색 실패: {e}", None)

    return [
        list_cases,
        analyze_case,
        generate_timeline,
        generate_relationship,
        search_precedents,
        summarize_precedent,
        compare_precedent,
        search_laws,
        get_case_evidence,
        rag_search,
    ]
