import json
import re
from typing import List, Optional
from app.models.case import Case
from app.models.timeline import TimeLine
from app.models.evidence import Evidence
from app.prompts.timeline_prompt import create_timeline_prompt


class TimeLineService:
    """
    타임라인 자동 생성 서비스

    사건 정보와 증거를 분석하여 시간순 타임라인을 자동으로 생성합니다.
    """

    def __init__(self, case: Case, use_llm: bool = False):
        """
        Args:
            case: 사건 정보
            use_llm: LLM을 사용할지 여부 (기본값: False, 샘플 데이터 사용)
        """
        self.case = case
        self.use_llm = use_llm

    def execute(
        self,
        summary: Optional[str] = None,
        facts: Optional[str] = None,
        claims: Optional[str] = None,
        evidences: Optional[List[Evidence]] = None
    ) -> List[TimeLine]:
        """
        타임라인 생성 실행

        Args:
            summary: 사건 요약
            facts: 사실관계
            claims: 청구 내용
            evidences: 증거 목록

        Returns:
            생성된 타임라인 리스트
        """
        if self.use_llm and summary and facts:
            # LLM을 사용한 자동 생성
            return self._generate_with_llm(summary, facts, claims, evidences)
        else:
            # 샘플 데이터 사용 (개발/테스트용)
            return self._generate_sample_timeline()

    def _generate_with_llm(
        self,
        summary: str,
        facts: str,
        claims: Optional[str],
        evidences: Optional[List[Evidence]]
    ) -> List[TimeLine]:
        """
        LLM을 사용하여 타임라인 자동 생성

        Args:
            summary: 사건 요약
            facts: 사실관계
            claims: 청구 내용
            evidences: 증거 목록

        Returns:
            생성된 타임라인 리스트
        """
        # 증거 목록을 텍스트로 변환
        evidence_text = self._format_evidences(evidences)

        # LLM 프롬프트 생성
        prompt = create_timeline_prompt(
            summary=summary,
            facts=facts,
            claims=claims or "",
            evidence_list=evidence_text
        )

        # TODO: 실제 LLM API 호출
        # from app.services.llm_service import LLMService
        # llm_service = LLMService()
        # response = await llm_service.generate_response(prompt)
        # timeline_data = json.loads(response["response"])

        # 임시: 샘플 응답 사용 (실제 LLM 연동 전까지)
        print("LLM 프롬프트 생성 완료. 실제 LLM API 연동 필요.")
        print(f"프롬프트 길이: {len(prompt)} characters")

        # LLM 응답이 없으면 샘플 데이터 반환
        return self._generate_sample_timeline()

    def _format_evidences(self, evidences: Optional[List[Evidence]]) -> str:
        """
        증거 목록을 텍스트로 포맷팅

        Args:
            evidences: 증거 목록

        Returns:
            포맷팅된 증거 목록 텍스트
        """
        if not evidences:
            return "증거 없음"

        evidence_lines = []
        for i, evidence in enumerate(evidences, 1):
            line = f"{i}. {evidence.file_name}"
            if evidence.doc_type:
                line += f" ({evidence.doc_type})"
            if evidence.content:
                # 내용이 너무 길면 앞부분만 사용
                content_preview = evidence.content[:200] + "..." if len(evidence.content) > 200 else evidence.content
                line += f"\n   내용: {content_preview}"
            if evidence.created_at:
                line += f"\n   등록일: {evidence.created_at.strftime('%Y-%m-%d %H:%M')}"
            evidence_lines.append(line)

        return "\n\n".join(evidence_lines)

    def _parse_llm_response(self, llm_response: str) -> List[dict]:
        """
        LLM 응답을 파싱하여 타임라인 데이터 추출

        Args:
            llm_response: LLM의 JSON 응답

        Returns:
            타임라인 데이터 리스트
        """
        try:
            # JSON 코드 블록에서 추출
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', llm_response)
            if json_match:
                json_str = json_match.group(1)
            else:
                # 코드 블록이 없으면 전체 응답을 JSON으로 파싱 시도
                json_str = llm_response

            timeline_data = json.loads(json_str)
            return timeline_data
        except json.JSONDecodeError as e:
            print(f"LLM 응답 파싱 실패: {e}")
            print(f"응답 내용: {llm_response[:500]}")
            return []

    def _create_timeline_from_data(self, data: List[dict]) -> List[TimeLine]:
        """
        데이터 딕셔너리에서 TimeLine 객체 생성

        Args:
            data: 타임라인 데이터 리스트

        Returns:
            TimeLine 객체 리스트
        """
        timelines = []
        for item in data:
            timeline = TimeLine()
            # ID는 DB에서 자동 생성 (get_time_id() 함수)
            timeline.date = item.get("date", "미상")
            timeline.time = item.get("time", "00:00")
            timeline.title = item.get("title", "제목 없음")
            timeline.description = item.get("description", "")
            timeline.type = item.get("type", "기타")
            timeline.actor = item.get("actor", "")

            timelines.append(timeline)
            self.case.timelines.append(timeline)

        return timelines

    def _generate_sample_timeline(self) -> List[TimeLine]:
        """
        샘플 타임라인 생성 (개발/테스트용)

        Returns:
            샘플 타임라인 리스트
        """
        sample_data = [
            {
                "id": "1",
                "date": "2025-11-15",
                "time": "09:30",
                "title": "단톡방 첫 비방 발언",
                "description": "피고소인 박OO가 34명 단체 카카오톡 채팅방에서 의뢰인에 대해 '업무능력이 없다'는 발언을 최초로 함",
                "type": "상대방",
                "actor": "박OO (피고소인)",
            },
            {
                "id": "2",
                "date": "2025-11-15",
                "time": "14:32",
                "title": "단톡방 대화 캡처 확보",
                "description": "의뢰인이 명예훼손 발언이 담긴 카카오톡 대화를 캡처하여 증거로 확보",
                "type": "증거",
                "actor": "캡처 이미지",
            },
            {
                "id": "3",
                "date": "2025-11-20",
                "time": "10:15",
                "title": "횡령 허위사실 유포",
                "description": "피고소인이 '회사 돈을 횡령했다'는 허위사실을 단톡방에 유포",
                "type": "상대방",
                "actor": "박OO (피고소인)",
            },
            {
                "id": "4",
                "date": "2025-11-25",
                "time": "11:00",
                "title": "의뢰인 해명 시도",
                "description": "의뢰인 김OO가 단톡방에서 허위사실에 대해 해명을 시도하였으나 추가 비방을 받음",
                "type": "의뢰인",
                "actor": "김OO (의뢰인)",
            },
            {
                "id": "5",
                "date": "2025-12-01",
                "time": "15:20",
                "title": "회식 자리 녹취 확보",
                "description": "회식 자리에서 피고소인의 추가 모욕 발언이 녹취됨. '사기꾼' 발언 포함",
                "type": "증거",
                "actor": "음성 녹취",
            },
            {
                "id": "6",
                "date": "2025-12-01",
                "time": "19:30",
                "title": "공개적 모욕 발언",
                "description": "피고소인이 회식 자리(15명 참석)에서 의뢰인을 '사기꾼'이라고 공개적으로 모욕",
                "type": "상대방",
                "actor": "박OO (피고소인)",
            },
            {
                "id": "7",
                "date": "2025-12-10",
                "time": "10:00",
                "title": "목격자 진술 확보",
                "description": "의뢰인이 동료 2명으로부터 피고소인의 발언을 목격했다는 진술서를 확보",
                "type": "증거",
                "actor": "진술서",
            },
            {
                "id": "8",
                "date": "2026-01-05",
                "time": "14:00",
                "title": "법률 상담 진행",
                "description": "의뢰인이 명예훼손 피해에 대한 법률 상담을 진행하고 사건 수임 결정",
                "type": "의뢰인",
                "actor": "김OO (의뢰인)",
            }
        ]

        for data in sample_data:
            timeline = TimeLine()
            # ID는 DB에서 자동 생성 (get_time_id() 함수)
            timeline.date = data["date"]
            timeline.time = data["time"]
            timeline.title = data["title"]
            timeline.description = data["description"]
            timeline.type = data["type"]
            timeline.actor = data["actor"]

            self.case.timelines.append(timeline)

        return self.case.timelines

    # 하위 호환성을 위한 별칭
    def excute(self) -> List[TimeLine]:
        """
        excute 메서드 (오타지만 하위 호환성 유지)
        """
        return self.execute()
