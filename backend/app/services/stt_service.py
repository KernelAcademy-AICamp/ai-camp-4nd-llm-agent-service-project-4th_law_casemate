from fastapi import UploadFile
from openai import AsyncOpenAI
import os

class STTService:
    """OpenAI Whisper API를 사용한 음성-텍스트 변환 서비스"""

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY 환경 변수가 설정되지 않았습니다")
        self.client = AsyncOpenAI(api_key=api_key)

    async def run(self, file: UploadFile) -> str:
        """
        오디오 파일을 텍스트로 변환

        Args:
            file: 업로드된 오디오 파일

        Returns:
            변환된 텍스트 문자열
        """
        try:
            # 파일 포인터를 처음으로 이동
            await file.seek(0)

            # 파일 내용을 읽기
            file_content = await file.read()

            # 안전한 파일명 생성 (확장자만 추출)
            # 예: "단톡방 1.mp3" → "audio.mp3"
            import os
            file_extension = os.path.splitext(file.filename)[1]  # ".mp3"
            safe_filename = f"audio{file_extension}"  # "audio.mp3"

            # OpenAI Whisper API는 파일명(확장자)이 필요하므로 튜플 형식으로 전달
            # (filename, file_content, content_type)
            transcript = await self.client.audio.transcriptions.create(
                model="whisper-1",
                file=(safe_filename, file_content, file.content_type),
                language="ko"  # 한국어 우선 인식
            )

            return transcript.text

        except Exception as e:
            print(f"❌ OpenAI Whisper API 호출 실패: {str(e)}")
            raise e
