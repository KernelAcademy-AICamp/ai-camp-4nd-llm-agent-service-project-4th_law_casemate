"""
에이전트 도구 정의 — 기존 백엔드 서비스를 @tool로 래핑

create_tools(user_id, law_firm_id)를 호출하면
해당 사용자 전용 도구 세트(8개)를 반환한다.

반환 형식: JSON 문자열 {"text": "LLM용 마크다운", "data": 구조화 데이터}
"""

import json
import logging
from langchain_core.tools import tool, ToolException
from tool.database import SessionLocal
from app.models.evidence import Case, CaseAnalysis, Evidence, CaseEvidenceMapping

logger = logging.getLogger(__name__)


def _structured_return(text: str, data) -> str:
    """LLM용 텍스트 + 프론트 리치 렌더링용 구조화 데이터를 JSON 문자열로 반환"""
    return json.dumps({"text": text, "data": data}, ensure_ascii=False)


def create_tools(user_id: int, law_firm_id: int):
    """사용자별 도구 세트 생성 (클로저로 user_id/law_firm_id 캡처)"""

    @tool
    def list_cases() -> str:
        """사용자의 사건 목록을 조회합니다.

        사건 ID, 제목, 의뢰인, 상대방, 사건 유형, 상태, 증거 수, 분석 여부, 등록일(created_at)을 반환합니다.
        사건 분석이나 타임라인 생성 전에 어떤 사건이 있는지 확인할 때 사용하세요.
        증거 유무, 분석 여부, 등록일 기준 질문(이번 달/이번 주 등록된 사건, 가장 최근 사건 등)도 이 결과만으로 답할 수 있습니다.
        """
        from sqlalchemy import func as sa_func, text as sql_text

        db = SessionLocal()
        try:
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

            from sqlalchemy.orm import aliased
            rows = (
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
                .order_by(Case.created_at.desc())
                .limit(20)
                .all()
            )
            if not rows:
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
            raise ToolException(f"사건 목록 조회 실패: {e}")
        finally:
            db.close()

    @tool
    def analyze_case(case_id: int) -> str:
        """사건의 AI 분석 결과를 조회합니다. 요약, 사실관계, 주장사항, 관련 법률을 반환합니다.

        Args:
            case_id: 분석할 사건 ID (list_cases로 확인 가능)

        주의: 타임라인 생성, 관계도 생성 전에 반드시 이 도구를 먼저 호출하세요.
        이미 분석된 사건이면 캐시된 결과를 즉시 반환합니다.
        아직 분석되지 않은 사건이면 안내 메시지를 반환합니다.
        """
        db = SessionLocal()
        try:
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
            raise ToolException(f"사건 분석 조회 실패: {e}")
        finally:
            db.close()

    @tool
    async def generate_timeline(case_id: int) -> str:
        """사건의 타임라인(시간순 사건 흐름)을 생성합니다.

        Args:
            case_id: 사건 ID

        주의: analyze_case가 먼저 완료되어야 합니다.
        """
        from app.services.timeline_service import TimeLineService

        db = SessionLocal()
        try:
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
            raise ToolException(f"타임라인 생성 실패: {e}")
        finally:
            db.close()

    @tool
    async def generate_relationship(case_id: int) -> str:
        """사건 관계자들의 관계도를 생성합니다.

        Args:
            case_id: 사건 ID

        주의: analyze_case가 먼저 완료되어야 합니다.
        """
        from app.services.relationship_service import RelationshipService

        db = SessionLocal()
        try:
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
            raise ToolException(f"관계도 생성 실패: {e}")
        finally:
            db.close()

    @tool
    def search_precedents(query: str, limit: int = 5) -> str:
        """판례를 키워드로 검색합니다. 유사 판례를 찾을 때 사용하세요.

        Args:
            query: 검색 키워드 (예: "사기죄 공소시효", "교통사고 손해배상")
            limit: 반환할 결과 수 (기본값: 5)
        """
        from app.services.precedent_search_service import PrecedentSearchService

        try:
            service = PrecedentSearchService()
            result = service.search_cases(query=query, limit=limit)

            items = result.get("results", [])
            if not items:
                return _structured_return(f"'{query}'에 대한 판례를 찾지 못했습니다.", [])

            data = []
            lines = [f"## 판례 검색 결과 ({len(items)}건)\n"]
            for i, item in enumerate(items, 1):
                data.append({
                    "case_number": item.get("case_number", "?"),
                    "case_name": item.get("case_name", "?"),
                    "court": item.get("court_name", "?"),
                    "judgment_date": item.get("judgment_date", "?"),
                    "content_snippet": (item.get("content", "") or "")[:500],
                })
                lines.append(
                    f"### {i}. {item.get('case_number', '?')}\n"
                    f"- 사건명: {item.get('case_name', '?')}\n"
                    f"- 법원: {item.get('court_name', '?')}\n"
                    f"- 선고일: {item.get('judgment_date', '?')}\n"
                    f"- 내용: {(item.get('content', '') or '')[:500]}\n"
                )
            text = "\n".join(lines)
            return _structured_return(text, data)
        except Exception as e:
            raise ToolException(f"판례 검색 실패: {e}")

    @tool
    def summarize_precedent(case_number: str, content: str) -> str:
        """특정 판례를 요약합니다.

        Args:
            case_number: 판례 사건번호 (예: "2023다12345")
            content: 판례 내용 텍스트 (search_precedents 결과에서 가져옴)
        """
        from app.services.precedent_summary_service import SummaryService

        try:
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
            raise ToolException(f"판례 요약 실패: {e}")

    @tool
    def compare_precedent(case_id: int, target_case_number: str) -> str:
        """내 사건과 특정 판례를 비교 분석합니다.

        Args:
            case_id: 비교할 내 사건 ID
            target_case_number: 비교 대상 판례 사건번호

        주의: search_precedents로 먼저 판례를 검색한 후 사용하세요.
        """
        from app.services.comparison_service import ComparisonService

        db = SessionLocal()
        try:
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
            raise ToolException(f"판례 비교 실패: {e}")
        finally:
            db.close()

    @tool
    def search_laws(query: str, limit: int = 8) -> str:
        """법령을 키워드로 검색합니다. 관련 법조문을 찾을 때 사용하세요.

        Args:
            query: 검색 키워드 (예: "사기죄", "민법 손해배상", "주거침입")
            limit: 반환할 결과 수 (기본값: 8)
        """
        from app.services.search_laws_service import SearchLawsService

        try:
            service = SearchLawsService()
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
            raise ToolException(f"법령 검색 실패: {e}")

    @tool
    def get_case_evidence(case_id: int) -> str:
        """사건에 연결된 증거 파일 목록과 분석 현황을 조회합니다.

        Args:
            case_id: 사건 ID

        증거 현황, 파일 목록, 분석 여부를 확인할 때 사용하세요.
        """
        from sqlalchemy import text as sql_text

        db = SessionLocal()
        try:
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
            raise ToolException(f"증거 현황 조회 실패: {e}")
        finally:
            db.close()

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
    ]
