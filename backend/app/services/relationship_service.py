"""
관계도 생성 및 관리 서비스
"""
import json
import logging
import os
from typing import List, Dict, Tuple
from openai import AsyncOpenAI
from fastapi import HTTPException
from sqlalchemy.orm import Session

# DB 모델들
from app.models.evidence import Case, CaseSummary
from app.models.timeline import TimeLine
from app.models.relationship import CasePerson, CaseRelationship
from app.prompts.relationship_prompt import create_relationship_prompt

# 로거 설정
logger = logging.getLogger(__name__)


class RelationshipService:
    """관계도 생성 및 관리 서비스"""

    def __init__(self, db: Session, case_id: int):
        """
        Args:
            db: 데이터베이스 세션
            case_id: 사건 ID
        """
        self.db = db
        self.case_id = case_id
        self.openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    async def generate_relationship(self) -> Dict:
        """
        관계도 자동 생성

        Flow:
        1. DB에서 case, timeline, case_summary 가져오기
        2. OpenAI API 호출하여 관계도 JSON 생성
        3. 응답 파싱
        4. DB에 저장 (기존 데이터 삭제 후 재생성)
        5. 저장된 관계도 반환

        Returns:
            Dict: {"persons": [...], "relationships": [...]}

        Raises:
            HTTPException: 사건을 찾을 수 없거나 OpenAI API 실패 시
        """
        logger.info(f"[Relationship Generation] 시작: case_id={self.case_id}")

        # 1. DB에서 데이터 조회
        case, timelines, case_summary = self._fetch_case_data()
        logger.info(f"[Relationship Generation] 데이터 조회 완료: timelines={len(timelines)}개")

        # 2. Case Summary에서 데이터 추출 (또는 타임라인 기반 자동 생성)
        if case_summary:
            summary = case_summary.summary or case.title or "사건 요약 없음"
            facts = case_summary.facts or case.description or "사실관계 없음"
            logger.info(f"[Relationship Generation] Case Summary 캐시 히트")
        else:
            logger.warning(f"[Relationship Generation] Case Summary 캐시 미스 - 타임라인 데이터로부터 자동 생성")
            summary, facts = await self._generate_summary_from_timeline(
                case, timelines
            )

        # 3. 타임라인 요약 생성
        timeline_summary = self._create_timeline_summary(timelines)

        # 4. LLM으로 관계도 생성
        relationship_data = await self._generate_with_llm(
            summary, facts, timeline_summary,
            client_name=case.client_name,
            client_role=case.client_role
        )

        if not relationship_data:
            logger.error(f"[Relationship Generation] LLM 응답 파싱 실패 - 관계도 생성 불가")
            raise HTTPException(
                status_code=500,
                detail="관계도 생성에 실패했습니다. LLM 응답을 파싱할 수 없습니다."
            )

        logger.info(f"[Relationship Generation] 관계도 생성 완료: persons={len(relationship_data['persons'])}명, relationships={len(relationship_data['relationships'])}개")

        # 5. DB에 저장 (기존 데이터 삭제 후 재생성)
        saved_data = self._save_to_db(relationship_data, firm_id=case.law_firm_id)
        logger.info(f"[Relationship Generation] DB 저장 완료")

        return saved_data

    def get_relationship(self) -> Dict:
        """
        관계도 조회

        Returns:
            Dict: {"persons": [...], "relationships": [...]}

        Raises:
            HTTPException: 관계도를 찾을 수 없을 때
        """
        persons = self.db.query(CasePerson).filter(
            CasePerson.case_id == self.case_id
        ).all()

        relationships = self.db.query(CaseRelationship).filter(
            CaseRelationship.case_id == self.case_id
        ).all()

        if not persons:
            raise HTTPException(
                status_code=404,
                detail="관계도가 존재하지 않습니다. 먼저 생성해주세요."
            )

        return {
            "persons": [person.to_dict() for person in persons],
            "relationships": [rel.to_dict() for rel in relationships]
        }

    def delete_relationship(self) -> None:
        """
        관계도 삭제

        Raises:
            HTTPException: 사건을 찾을 수 없을 때
        """
        # Case 존재 확인
        case = self.db.query(Case).filter(Case.id == self.case_id).first()
        if not case:
            raise HTTPException(
                status_code=404,
                detail=f"사건 ID {self.case_id}를 찾을 수 없습니다"
            )

        # 관계 먼저 삭제 (FK 제약 조건)
        self.db.query(CaseRelationship).filter(
            CaseRelationship.case_id == self.case_id
        ).delete()

        # 인물 삭제
        self.db.query(CasePerson).filter(
            CasePerson.case_id == self.case_id
        ).delete()

        self.db.commit()
        logger.info(f"[Relationship Delete] case_id={self.case_id} 삭제 완료")

    def _fetch_case_data(self) -> Tuple[Case, List[TimeLine], CaseSummary]:
        """
        DB에서 case 데이터 조회

        Returns:
            Tuple: (case, timelines, case_summary)

        Raises:
            HTTPException: 사건을 찾을 수 없을 때
        """
        # Case 조회
        case = self.db.query(Case).filter(Case.id == self.case_id).first()
        if not case:
            raise HTTPException(
                status_code=404,
                detail=f"사건 ID {self.case_id}를 찾을 수 없습니다"
            )

        # Timeline 조회
        timelines = self.db.query(TimeLine).filter(
            TimeLine.case_id == self.case_id
        ).order_by(TimeLine.order_index).all()

        # Case Summary 캐시 조회
        case_summary = self.db.query(CaseSummary).filter(
            CaseSummary.case_id == self.case_id
        ).first()

        return case, timelines, case_summary

    def _create_timeline_summary(self, timelines: List[TimeLine]) -> str:
        """
        타임라인을 요약 텍스트로 변환

        Args:
            timelines: 타임라인 목록

        Returns:
            str: 타임라인 요약 텍스트
        """
        if not timelines:
            return "타임라인 정보가 없습니다."

        summary_lines = []
        for i, timeline in enumerate(timelines, 1):
            line = f"{i}. [{timeline.date} {timeline.time}] {timeline.title}"
            if timeline.actor:
                line += f" - {timeline.actor}"
            if timeline.description:
                # description의 첫 100자만 사용
                desc = timeline.description[:100]
                if len(timeline.description) > 100:
                    desc += "..."
                line += f"\n   {desc}"
            summary_lines.append(line)

        return "\n\n".join(summary_lines)

    async def _generate_with_llm(
        self,
        summary: str,
        facts: str,
        timeline_summary: str,
        client_name: str = None,
        client_role: str = None
    ) -> Dict:
        """
        LLM을 사용하여 관계도 자동 생성

        Args:
            summary: 사건 요약
            facts: 사실관계
            timeline_summary: 타임라인 요약
            client_name: 의뢰인 이름
            client_role: 의뢰인 역할

        Returns:
            Dict: {"persons": [...], "relationships": [...]}

        Raises:
            HTTPException: OpenAI API 실패 시
        """
        # LLM 프롬프트 생성
        prompt = create_relationship_prompt(
            summary=summary,
            facts=facts,
            timeline_summary=timeline_summary,
            client_name=client_name or "의뢰인",
            client_role=client_role or "원고"
        )

        print(f"\n{'='*80}")
        print(f"[LLM 프롬프트 - 관계도]")
        print(f"{'='*80}")
        print(f"프롬프트 길이: {len(prompt)} characters")
        print(f"\n{prompt[:1000]}...")  # 처음 1000자만 출력
        print(f"{'='*80}\n")

        logger.info(f"[LLM] 프롬프트 생성 완료: {len(prompt)} characters")

        # OpenAI API 호출
        try:
            response = await self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "당신은 법률 사건의 인물 관계도를 분석하는 전문가입니다. 주어진 사건 정보를 바탕으로 정확한 JSON 형식의 관계도를 생성합니다."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,
                max_tokens=2000
            )

            llm_response = response.choices[0].message.content
            logger.info(f"[LLM] 응답 수신 완료: {len(llm_response)} characters")
            logger.info(f"\n{'='*80}\n[LLM 응답]\n{'='*80}\n{llm_response}\n{'='*80}")

            # JSON 파싱
            relationship_data = self._parse_llm_response(llm_response)
            logger.info(f"\n{'='*80}\n[파싱된 관계도 데이터]\n{'='*80}\n{relationship_data}\n{'='*80}")

            if not relationship_data:
                raise ValueError("LLM이 빈 관계도를 반환했습니다")

            return relationship_data

        except Exception as e:
            logger.error(f"[LLM] OpenAI API 호출 실패: {str(e)}")
            raise HTTPException(
                status_code=503,
                detail=f"관계도 생성 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요."
            )

    def _parse_llm_response(self, llm_response: str) -> Dict:
        """
        LLM 응답을 파싱하여 관계도 데이터 추출

        Args:
            llm_response: LLM 응답 텍스트

        Returns:
            Dict: {"persons": [...], "relationships": [...]} 또는 None
        """
        try:
            # JSON 코드 블록 제거
            if "```json" in llm_response:
                llm_response = llm_response.split("```json")[1].split("```")[0].strip()
            elif "```" in llm_response:
                llm_response = llm_response.split("```")[1].split("```")[0].strip()

            # JSON 파싱
            data = json.loads(llm_response)

            # 필수 필드 검증
            if "persons" not in data or "relationships" not in data:
                logger.error(f"[Parse] 필수 필드 누락: persons 또는 relationships")
                return None

            # persons 검증
            valid_persons = []
            for person in data["persons"]:
                if "name" in person and "role" in person:
                    valid_persons.append(person)
                else:
                    logger.warning(f"[Parse] 잘못된 person 데이터: {person}")

            # relationships 검증
            valid_relationships = []
            person_names = {p["name"] for p in valid_persons}
            for rel in data["relationships"]:
                # 필수 필드 확인
                if "source" not in rel or "target" not in rel or "type" not in rel:
                    logger.warning(f"[Parse] 잘못된 relationship 데이터: {rel}")
                    continue

                # source와 target이 persons에 존재하는지 확인
                if rel["source"] not in person_names or rel["target"] not in person_names:
                    logger.warning(f"[Parse] 존재하지 않는 인물 참조: {rel}")
                    continue

                valid_relationships.append(rel)

            result = {
                "persons": valid_persons,
                "relationships": valid_relationships
            }

            logger.info(f"[Parse] 파싱 성공: {len(valid_persons)}명, {len(valid_relationships)}개 관계")
            return result

        except json.JSONDecodeError as e:
            logger.error(f"[Parse] JSON 파싱 실패: {e}")
            logger.debug(f"[Parse] 응답 내용 (처음 500자): {llm_response[:500]}")
            return None

    def _save_to_db(self, relationship_data: Dict, firm_id: int = None) -> Dict:
        """
        관계도 데이터를 DB에 저장

        Args:
            relationship_data: {"persons": [...], "relationships": [...]}
            firm_id: 법무법인 ID (선택)

        Returns:
            Dict: 저장된 관계도 데이터
        """
        # 기존 관계도 삭제
        self.db.query(CaseRelationship).filter(
            CaseRelationship.case_id == self.case_id
        ).delete()
        self.db.query(CasePerson).filter(
            CasePerson.case_id == self.case_id
        ).delete()

        # 인물 저장
        person_id_map = {}  # name -> id 매핑
        saved_persons = []

        # 자동 좌표 분산 (3열 그리드)
        for index, person_data in enumerate(relationship_data["persons"]):
            # 3열 그리드 형태로 배치 (300px 간격)
            col = index % 3
            row = index // 3
            auto_x = 150 + (col * 250)  # 150, 400, 650
            auto_y = 150 + (row * 180)  # 150, 330, 510, ...

            person = CasePerson(
                case_id=self.case_id,
                firm_id=firm_id,
                name=person_data["name"],
                role=person_data["role"],
                description=person_data.get("description", ""),
                position_x=auto_x,
                position_y=auto_y
            )
            self.db.add(person)
            self.db.flush()  # ID 생성
            person_id_map[person_data["name"]] = person.id
            saved_persons.append(person)
            logger.info(f"[Relationship Save] 인물 저장: {person.name} (ID: {person.id}, 좌표: {auto_x}, {auto_y})")

        # 관계 저장
        saved_relationships = []

        for rel_data in relationship_data["relationships"]:
            source_name = rel_data["source"]
            target_name = rel_data["target"]

            # 인물이 존재하는지 확인
            if source_name not in person_id_map or target_name not in person_id_map:
                logger.warning(f"[Relationship Save] 인물을 찾을 수 없음: {source_name} -> {target_name}")
                continue

            relationship = CaseRelationship(
                case_id=self.case_id,
                firm_id=firm_id,
                source_person_id=person_id_map[source_name],
                target_person_id=person_id_map[target_name],
                relationship_type=rel_data["type"],
                label=rel_data.get("label", rel_data["type"]),
                memo=rel_data.get("memo", ""),
                is_directed=rel_data.get("directed", True)
            )
            self.db.add(relationship)
            saved_relationships.append(relationship)
            logger.info(f"[Relationship Save] 관계 저장: {source_name} -> {target_name} ({relationship.relationship_type})")

        self.db.commit()

        return {
            "persons": [person.to_dict() for person in saved_persons],
            "relationships": [rel.to_dict() for rel in saved_relationships]
        }

    async def _generate_summary_from_timeline(
        self,
        case: Case,
        timelines: List[TimeLine]
    ) -> tuple:
        """
        타임라인 데이터로부터 사건 요약과 사실관계를 LLM으로 생성

        Args:
            case: Case 객체
            timelines: 타임라인 목록

        Returns:
            tuple: (summary, facts)
        """
        logger.info(f"[Summary Generation] 타임라인 기반 요약 생성 시작")

        # 타임라인 요약 생성
        timeline_summary = self._create_timeline_summary(timelines)

        # 타임라인이 없으면 기본값 반환
        if not timelines or "타임라인 정보가 없습니다" in timeline_summary:
            logger.warning(f"[Summary Generation] 타임라인 없음 - 기본값 반환")
            return (
                case.title or "사건 요약 없음",
                case.description or "사실관계 없음"
            )

        # LLM 프롬프트
        prompt = f"""당신은 법률 사건 분석 전문가입니다.
아래 사건 정보와 타임라인을 바탕으로 사건의 요약과 사실관계를 분석해주세요.

**사건 정보:**
- 제목: {case.title or "제목 없음"}
- 설명: {case.description or "설명 없음"}
- 의뢰인: {case.client_name or "미상"} ({case.client_role or "역할 미상"})

**타임라인:**
{timeline_summary[:2000]}  # 너무 길면 잘라냄

위 정보를 바탕으로 다음을 작성해주세요:

1. **사건 요약 (summary)**: 이 사건이 무엇에 관한 것인지 2-3 문장으로 간결하게 요약
2. **사실관계 (facts)**: 타임라인을 통해 확인되는 주요 사실들을 시간순으로 정리 (5-10 문장)

**응답 형식 (JSON):**
```json
{{
  "summary": "사건 요약 (2-3 문장)",
  "facts": "주요 사실관계 (타임라인 기반, 시간순 정리)"
}}
```"""

        try:
            response = await self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "당신은 법률 사건 분석 전문가입니다. 타임라인 정보를 바탕으로 사건을 객관적으로 분석하고 요약합니다."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                temperature=0.3,
                max_tokens=1500
            )

            llm_response = response.choices[0].message.content
            logger.info(f"[Summary Generation] LLM 응답 수신: {len(llm_response)} characters")

            # JSON 파싱
            import re
            json_match = re.search(r'```json\s*(.*?)\s*```', llm_response, re.DOTALL)
            if json_match:
                json_str = json_match.group(1)
            else:
                json_str = llm_response.strip()

            parsed = json.loads(json_str)
            summary = parsed.get("summary", case.title or "사건 요약 생성 실패")
            facts = parsed.get("facts", case.description or "사실관계 생성 실패")

            logger.info(f"[Summary Generation] 자동 생성 완료")
            logger.info(f"  - Summary: {summary[:100]}...")
            logger.info(f"  - Facts: {facts[:100]}...")

            return summary, facts

        except Exception as e:
            logger.error(f"[Summary Generation] LLM 생성 실패: {str(e)}")
            # Fallback to basic values
            return (
                case.title or "사건 요약 없음",
                case.description or "사실관계 없음"
            )
