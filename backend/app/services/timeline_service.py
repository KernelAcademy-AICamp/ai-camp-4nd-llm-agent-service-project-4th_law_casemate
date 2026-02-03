import json
import re
import logging
import os
from typing import List, Optional
from openai import AsyncOpenAI
from fastapi import HTTPException
from sqlalchemy.orm import Session

# DB 모델들 (반드시 evidence.py에서 import!)
from app.models.evidence import Case, Evidence, CaseSummary, CaseEvidenceMapping
from app.models.timeline import TimeLine
from app.prompts.timeline_prompt import create_timeline_prompt

# 로거 설정
logger = logging.getLogger(__name__)


class TimeLineService:
    """
    타임라인 자동 생성 서비스

    사건 정보와 증거를 분석하여 시간순 타임라인을 자동으로 생성합니다.
    """

    def __init__(self, db: Session, case_id: int):
        """
        Args:
            db: SQLAlchemy 데이터베이스 세션
            case_id: 사건 ID (integer)
        """
        self.db = db
        self.case_id = case_id

        # OpenAI 클라이언트 초기화
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY 환경 변수가 설정되지 않았습니다")
        self.openai_client = AsyncOpenAI(api_key=api_key)

    async def generate_timeline_auto(self) -> List[TimeLine]:
        """
        타임라인 자동 생성 (사용자 요구사항 구현)

        Process:
        1. DB에서 case, evidence, case_summary 가져오기
        2. OpenAI API 호출하여 타임라인 JSON 생성
        3. 응답 파싱
        4. DB에 저장
        5. 저장된 TimeLine 객체 반환

        Returns:
            List[TimeLine]: 생성된 타임라인 리스트

        Raises:
            HTTPException: 사건을 찾을 수 없거나 OpenAI API 실패 시
        """
        logger.info(f"[Timeline Auto-Gen] 시작: case_id={self.case_id}")

        # 1. DB에서 데이터 조회
        case, evidences, case_summary, evidence_mappings = self._fetch_case_and_evidences()
        logger.info(f"[Timeline Auto-Gen] 데이터 조회 완료: evidences={len(evidences)}개, mappings={len(evidence_mappings)}개")

        # 2. Case Summary에서 데이터 추출 (또는 fallback)
        if case_summary:
            summary = case_summary.summary or case.title or "사건 요약 없음"
            facts = case_summary.facts or case.description or "사실관계 없음"
            claims = case_summary.claims or "청구내용 없음"
            logger.info(f"[Timeline Auto-Gen] Case Summary 캐시 히트")
        else:
            # Fallback
            summary = case.title or "사건 요약 없음"
            facts = case.description or "사실관계 없음"
            claims = "청구내용 없음"
            logger.warning(f"[Timeline Auto-Gen] Case Summary 캐시 미스 - fallback 사용")

        # 3. LLM으로 타임라인 생성
        timeline_data = await self._generate_with_llm(summary, facts, claims, evidences, evidence_mappings)

        if not timeline_data:
            logger.warning(f"[Timeline Auto-Gen] LLM 응답 파싱 실패 - 샘플 타임라인 사용")
            # Fallback: 샘플 타임라인 사용
            timeline_data = self._get_sample_timeline_data()

        logger.info(f"[Timeline Auto-Gen] 타임라인 생성 완료: {len(timeline_data)}개 이벤트")

        # 4. DB에 저장 (증거 연결 포함)
        saved_timelines = self._save_timelines_to_db(timeline_data, firm_id=case.law_firm_id, evidences=evidences)
        logger.info(f"[Timeline Auto-Gen] DB 저장 완료: {len(saved_timelines)}개")

        return saved_timelines

    def _fetch_case_and_evidences(self) -> tuple:
        """
        DB에서 case 데이터와 evidence 목록 조회

        Returns:
            tuple: (case: Case, evidences: List[Evidence], case_summary: CaseSummary | None, evidence_mappings: dict)

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

        # Evidence 조회 (content가 있는 것만)
        evidences = self.db.query(Evidence).filter(
            Evidence.case_id == self.case_id,
            Evidence.content.isnot(None),
            Evidence.content != ""
        ).all()

        # Case Summary 캐시 조회
        case_summary = self.db.query(CaseSummary).filter(
            CaseSummary.case_id == self.case_id
        ).first()

        # CaseEvidenceMapping 조회 (증거 날짜와 설명 정보)
        mappings = self.db.query(CaseEvidenceMapping).filter(
            CaseEvidenceMapping.case_id == self.case_id
        ).all()

        # evidence_id를 키로 하는 매핑 딕셔너리 생성
        evidence_mappings = {
            mapping.evidence_id: {
                "evidence_date": mapping.evidence_date,
                "description": mapping.description
            }
            for mapping in mappings
        }

        return case, evidences, case_summary, evidence_mappings

    def _save_timelines_to_db(self, timeline_data: List[dict], firm_id: int = None, evidences: List[Evidence] = None) -> List[TimeLine]:
        """
        타임라인 데이터를 DB에 저장

        Args:
            timeline_data: LLM이 반환한 타임라인 딕셔너리 리스트
            firm_id: 법무법인 ID (선택)
            evidences: 증거 목록 (증거 링크용)

        Returns:
            List[TimeLine]: 저장된 TimeLine 객체 리스트
        """
        saved_timelines = []

        for idx, item in enumerate(timeline_data):
            # 증거 연결 시도
            evidence_id = None
            if item.get("type") == "증거" and evidences:
                # actor 필드에서 증거 파일명 추출 시도
                actor = item.get("actor", "")
                for evidence in evidences:
                    # 파일명이 actor에 포함되어 있는지 확인
                    if evidence.file_name and evidence.file_name in actor:
                        evidence_id = evidence.id
                        logger.info(f"[Timeline Save] 증거 연결: {evidence.file_name} (ID: {evidence_id})")
                        break
                    # 또는 타이틀에 파일명이 포함되어 있는지 확인
                    elif evidence.file_name and evidence.file_name in item.get("title", ""):
                        evidence_id = evidence.id
                        logger.info(f"[Timeline Save] 증거 연결 (제목 기반): {evidence.file_name} (ID: {evidence_id})")
                        break

            timeline = TimeLine(
                case_id=self.case_id,
                firm_id=firm_id,
                evidence_id=evidence_id,
                date=item.get("date", "미상"),
                time=item.get("time", "00:00"),
                title=item.get("title", "제목 없음"),
                description=item.get("description", ""),
                type=item.get("type", "기타"),
                actor=item.get("actor", ""),
                order_index=idx
            )
            self.db.add(timeline)
            saved_timelines.append(timeline)

        # Commit
        self.db.commit()

        # Refresh to get IDs
        for timeline in saved_timelines:
            self.db.refresh(timeline)

        return saved_timelines

    async def _generate_with_llm(
        self,
        summary: str,
        facts: str,
        claims: str,
        evidences: List[Evidence],
        evidence_mappings: dict
    ) -> List[dict]:
        """
        LLM을 사용하여 타임라인 자동 생성

        Args:
            summary: 사건 요약
            facts: 사실관계
            claims: 청구 내용
            evidences: 증거 목록
            evidence_mappings: 증거 ID별 매핑 정보 (날짜, 설명)

        Returns:
            List[dict]: 타임라인 데이터 리스트

        Raises:
            HTTPException: OpenAI API 실패 시
        """
        # 증거 목록을 텍스트로 변환
        evidence_text = self._format_evidences(evidences, evidence_mappings)

        # LLM 프롬프트 생성
        prompt = create_timeline_prompt(
            summary=summary,
            facts=facts,
            claims=claims,
            evidence_list=evidence_text
        )

        logger.info(f"[LLM] 프롬프트 생성 완료: {len(prompt)} characters")
        logger.info(f"\n{'='*80}\n[LLM 프롬프트]\n{'='*80}\n{prompt}\n{'='*80}")

        # OpenAI API 호출
        try:
            response = await self.openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "당신은 법률 사건 타임라인 분석 전문가입니다. 주어진 사건 정보와 증거를 바탕으로 시간순 타임라인을 생성하고, 각 이벤트와 관련된 주요 쟁점사항도 함께 분석해주세요."
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
            timeline_data = self._parse_llm_response(llm_response)
            logger.info(f"\n{'='*80}\n[파싱된 타임라인 데이터]\n{'='*80}\n{timeline_data}\n{'='*80}")

            if not timeline_data:
                raise ValueError("LLM이 빈 타임라인을 반환했습니다")

            return timeline_data

        except Exception as e:
            logger.error(f"[LLM] OpenAI API 호출 실패: {str(e)}")
            raise HTTPException(
                status_code=503,
                detail=f"타임라인 생성 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요."
            )

    def _format_evidences(self, evidences: Optional[List[Evidence]], evidence_mappings: dict = None) -> str:
        """
        증거 목록을 텍스트로 포맷팅

        Args:
            evidences: 증거 목록
            evidence_mappings: 증거 ID별 매핑 정보 (날짜, 설명)

        Returns:
            str: 포맷팅된 증거 목록 텍스트
        """
        if not evidences:
            return "증거 텍스트가 아직 추출되지 않았습니다."

        # content가 있는 증거만 필터링
        evidences_with_content = [e for e in evidences if e.content]

        if not evidences_with_content:
            return "증거 텍스트가 아직 추출되지 않았습니다."

        evidence_lines = []
        for i, evidence in enumerate(evidences_with_content, 1):
            line = f"**증거 {i}: {evidence.file_name}**"

            # 문서 유형 명시
            if evidence.doc_type:
                line += f"\n문서 유형: {evidence.doc_type}"

            # CaseEvidenceMapping 정보 추가
            if evidence_mappings and evidence.id in evidence_mappings:
                mapping = evidence_mappings[evidence.id]

                # 증거 발생일
                if mapping.get("evidence_date"):
                    line += f"\n증거 발생일: {mapping['evidence_date']}"

                # 증거 설명 (사건 맥락)
                if mapping.get("description"):
                    line += f"\n증거 설명: {mapping['description']}"

            # 등록일
            if evidence.created_at:
                line += f"\n등록일: {evidence.created_at.strftime('%Y-%m-%d %H:%M')}"

            # 전체 content 포함 (LLM이 필요한 만큼 사용)
            if evidence.content:
                line += f"\n\n내용:\n{evidence.content}"

            evidence_lines.append(line)

        return "\n\n---\n\n".join(evidence_lines)

    def _parse_llm_response(self, llm_response: str) -> List[dict]:
        """
        LLM 응답을 파싱하여 타임라인 데이터 추출

        Args:
            llm_response: LLM의 JSON 응답

        Returns:
            List[dict]: 타임라인 데이터 리스트 (빈 리스트면 파싱 실패)
        """
        try:
            # JSON 코드 블록에서 추출
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', llm_response)
            if json_match:
                json_str = json_match.group(1)
            else:
                # 코드 블록이 없으면 전체 응답을 JSON으로 파싱 시도
                json_str = llm_response.strip()

            timeline_data = json.loads(json_str)

            # 배열인지 확인
            if not isinstance(timeline_data, list):
                logger.warning(f"[Parse] LLM이 배열이 아닌 응답 반환: {type(timeline_data)}")
                return []

            # 필수 필드 검증
            valid_data = []
            for item in timeline_data:
                # 필수 필드: date, time, title
                if all(key in item for key in ["date", "time", "title"]):
                    valid_data.append(item)
                else:
                    logger.warning(f"[Parse] 필수 필드 누락: {item}")

            logger.info(f"[Parse] 파싱 성공: {len(valid_data)}개 이벤트")
            return valid_data

        except json.JSONDecodeError as e:
            logger.error(f"[Parse] JSON 파싱 실패: {e}")
            logger.debug(f"[Parse] 응답 내용 (처음 500자): {llm_response[:500]}")
            return []

    def _get_sample_timeline_data(self) -> List[dict]:
        """
        샘플 타임라인 데이터 반환 (fallback용)

        Returns:
            List[dict]: 샘플 타임라인 데이터
        """
        return [
            {
                "date": "2025-11-15",
                "time": "09:30",
                "title": "단톡방 첫 비방 발언",
                "description": "피고소인 박OO가 34명 단체 카카오톡 채팅방에서 의뢰인에 대해 '업무능력이 없다'는 발언을 최초로 함. [쟁점] 명예훼손죄의 '사실 적시' 요건 충족 여부",
                "type": "상대방",
                "actor": "박OO (피고소인)",
            },
            {
                "date": "2025-11-15",
                "time": "14:32",
                "title": "단톡방 대화 캡처 확보",
                "description": "의뢰인이 명예훼손 발언이 담긴 카카오톡 대화를 캡처하여 증거로 확보",
                "type": "증거",
                "actor": "캡처 이미지",
            },
            {
                "date": "2025-11-20",
                "time": "10:15",
                "title": "횡령 허위사실 유포",
                "description": "피고소인이 '회사 돈을 횡령했다'는 허위사실을 단톡방에 유포. [쟁점] 허위사실 유포에 따른 명예훼손죄 성립 여부",
                "type": "상대방",
                "actor": "박OO (피고소인)",
            },
            {
                "date": "2025-11-25",
                "time": "11:00",
                "title": "의뢰인 해명 시도",
                "description": "의뢰인 김OO가 단톡방에서 허위사실에 대해 해명을 시도하였으나 추가 비방을 받음",
                "type": "의뢰인",
                "actor": "김OO (의뢰인)",
            },
            {
                "date": "2025-12-01",
                "time": "15:20",
                "title": "회식 자리 녹취 확보",
                "description": "회식 자리에서 피고소인의 추가 모욕 발언이 녹취됨. '사기꾼' 발언 포함",
                "type": "증거",
                "actor": "음성 녹취",
            },
            {
                "date": "2025-12-01",
                "time": "19:30",
                "title": "공개적 모욕 발언",
                "description": "피고소인이 회식 자리(15명 참석)에서 의뢰인을 '사기꾼'이라고 공개적으로 모욕. [쟁점] 모욕죄의 '공연성' 요건 충족 여부",
                "type": "상대방",
                "actor": "박OO (피고소인)",
            },
            {
                "date": "2025-12-10",
                "time": "10:00",
                "title": "목격자 진술 확보",
                "description": "의뢰인이 동료 2명으로부터 피고소인의 발언을 목격했다는 진술서를 확보",
                "type": "증거",
                "actor": "진술서",
            },
            {
                "date": "2026-01-05",
                "time": "14:00",
                "title": "법률 상담 진행",
                "description": "의뢰인이 명예훼손 피해에 대한 법률 상담을 진행하고 사건 수임 결정",
                "type": "의뢰인",
                "actor": "김OO (의뢰인)",
            }
        ]
