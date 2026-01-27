"""
증거 파일 처리 서비스
- 최소 비용, 최대 효율을 위한 하이브리드 처리 전략
- AUDIO: STT (OpenAI Whisper)
- PDF: 텍스트 추출 (무료) → 실패 시 Vision API
- IMAGE: Vision API (Low/High Detail)
"""

from fastapi import UploadFile
from openai import AsyncOpenAI
import os
import logging
from typing import Literal, Dict, Any
from io import BytesIO

# 로거 설정
logger = logging.getLogger(__name__)

FileType = Literal["IMAGE", "PDF", "AUDIO", "UNKNOWN"]
DetailLevel = Literal["low", "high"]


class EvidenceProcessor:
    """증거 파일 처리 프로세서"""

    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY 환경 변수가 설정되지 않았습니다")
        self.client = AsyncOpenAI(api_key=api_key)

    def identify_file_type(self, file: UploadFile) -> FileType:
        """
        파일 타입 식별

        Args:
            file: 업로드된 파일

        Returns:
            FileType: IMAGE, PDF, AUDIO, UNKNOWN
        """
        content_type = file.content_type or ""
        filename = file.filename or ""

        # MIME 타입 기반 식별
        if content_type.startswith("audio/"):
            return "AUDIO"
        elif content_type.startswith("image/"):
            return "IMAGE"
        elif content_type == "application/pdf" or filename.lower().endswith(".pdf"):
            return "PDF"

        # 확장자 기반 식별 (fallback)
        ext = filename.lower().split(".")[-1] if "." in filename else ""
        if ext in ["mp3", "wav", "m4a", "ogg", "webm", "flac", "mpeg", "mpga"]:
            return "AUDIO"
        elif ext in ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff"]:
            return "IMAGE"
        elif ext == "pdf":
            return "PDF"

        logger.warning(f"알 수 없는 파일 타입: {content_type}, {filename}")
        return "UNKNOWN"

    async def process_audio(self, file: UploadFile) -> Dict[str, Any]:
        """
        오디오 파일 처리 (STT)

        Args:
            file: 오디오 파일

        Returns:
            처리 결과 딕셔너리
        """
        from app.services.stt_service import STTService

        try:
            logger.info(f"🎤 오디오 파일 STT 시작: {file.filename}")

            stt_service = STTService()
            text = await stt_service.run(file)

            logger.info(f"✅ STT 완료: {len(text)}자 추출")
            logger.debug(f"📝 추출된 텍스트 (처음 200자): {text[:200]}")

            return {
                "success": True,
                "type": "AUDIO",
                "method": "openai-whisper",
                "text": text,
                "char_count": len(text),
                "cost_estimate": "저비용 (STT)"
            }

        except Exception as e:
            logger.error(f"❌ 오디오 처리 실패: {str(e)}")
            return {
                "success": False,
                "type": "AUDIO",
                "error": str(e)
            }

    async def process_pdf(self, file: UploadFile, detail: DetailLevel = "high") -> Dict[str, Any]:
        """
        PDF 파일 처리 (텍스트 추출 → Vision API)

        Args:
            file: PDF 파일
            detail: Vision API detail 레벨 (low/high)

        Returns:
            처리 결과 딕셔너리
        """
        try:
            import fitz  # PyMuPDF

            logger.info(f"📄 PDF 파일 처리 시작: {file.filename}")

            # 파일 내용 읽기
            await file.seek(0)
            file_content = await file.read()

            # PDF 열기
            pdf_document = fitz.open(stream=file_content, filetype="pdf")
            total_pages = len(pdf_document)
            logger.info(f"📚 PDF 총 페이지 수: {total_pages}")

            extracted_text = ""
            image_pages = []

            # 각 페이지별로 텍스트 추출 시도
            for page_num in range(total_pages):
                page = pdf_document[page_num]
                page_text = page.get_text()

                # 페이지당 20자 미만이면 이미지형 페이지로 간주
                if len(page_text.strip()) < 20:
                    logger.warning(f"⚠️ 페이지 {page_num + 1}: 텍스트 부족 ({len(page_text.strip())}자) - 이미지형 페이지")
                    image_pages.append(page_num)
                else:
                    extracted_text += f"\n\n=== 페이지 {page_num + 1} ===\n{page_text}"

            pdf_document.close()

            # 텍스트 PDF (모든 페이지에서 충분한 텍스트 추출됨)
            if len(image_pages) == 0:
                logger.info(f"✅ 텍스트 PDF: {len(extracted_text)}자 추출 (비용 0원)")
                logger.debug(f"📝 추출된 텍스트 (처음 200자): {extracted_text[:200]}")

                return {
                    "success": True,
                    "type": "PDF",
                    "method": "pymupdf-text",
                    "text": extracted_text.strip(),
                    "char_count": len(extracted_text),
                    "total_pages": total_pages,
                    "cost_estimate": "무료 (텍스트 추출)"
                }

            # 이미지형 PDF (일부 페이지가 이미지)
            logger.warning(f"⚠️ 이미지형 PDF: {len(image_pages)}개 페이지를 Vision API로 처리 필요")

            # Vision API로 이미지 페이지 처리
            vision_text = await self._process_pdf_with_vision(
                file_content, image_pages, detail
            )

            combined_text = extracted_text + "\n\n" + vision_text

            logger.info(f"✅ 하이브리드 PDF 처리 완료: {len(combined_text)}자")
            logger.debug(f"📝 최종 텍스트 (처음 200자): {combined_text[:200]}")

            return {
                "success": True,
                "type": "PDF",
                "method": "pymupdf+vision",
                "text": combined_text.strip(),
                "char_count": len(combined_text),
                "total_pages": total_pages,
                "text_pages": total_pages - len(image_pages),
                "image_pages": len(image_pages),
                "cost_estimate": f"저비용 (Vision API {len(image_pages)}페이지)"
            }

        except ImportError:
            logger.error("❌ PyMuPDF(fitz)가 설치되지 않았습니다. pip install pymupdf")
            return {
                "success": False,
                "type": "PDF",
                "error": "PyMuPDF not installed"
            }
        except Exception as e:
            logger.error(f"❌ PDF 처리 실패: {str(e)}")
            return {
                "success": False,
                "type": "PDF",
                "error": str(e)
            }

    async def _process_pdf_with_vision(
        self,
        pdf_content: bytes,
        page_numbers: list[int],
        detail: DetailLevel
    ) -> str:
        """
        PDF의 이미지형 페이지를 Vision API로 처리

        Args:
            pdf_content: PDF 파일 내용
            page_numbers: 처리할 페이지 번호 리스트
            detail: low/high

        Returns:
            추출된 텍스트
        """
        import fitz
        import base64

        pdf_document = fitz.open(stream=pdf_content, filetype="pdf")
        extracted_text = ""

        for page_num in page_numbers:
            page = pdf_document[page_num]

            # 페이지를 이미지로 변환
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))  # 2배 해상도
            img_bytes = pix.tobytes("png")

            # Base64 인코딩
            img_base64 = base64.b64encode(img_bytes).decode("utf-8")

            # Vision API 호출
            try:
                response = await self.client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": "이 이미지에서 모든 텍스트를 정확하게 추출해주세요. 법률 문서이므로 번호, 기호, 서명 등도 정확히 인식해주세요."
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/png;base64,{img_base64}",
                                        "detail": detail
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens=2000
                )

                page_text = response.choices[0].message.content
                extracted_text += f"\n\n=== 페이지 {page_num + 1} (Vision API) ===\n{page_text}"

                logger.info(f"✅ Vision API - 페이지 {page_num + 1}: {len(page_text)}자 추출")

            except Exception as e:
                logger.error(f"❌ Vision API 실패 - 페이지 {page_num + 1}: {str(e)}")

        pdf_document.close()
        return extracted_text

    async def process_image(
        self,
        file: UploadFile,
        detail: DetailLevel = "high"
    ) -> Dict[str, Any]:
        """
        이미지 파일 처리 (로컬 OCR → Vision API)

        Args:
            file: 이미지 파일
            detail: low (85토큰) / high (512px 타일 분석)

        Returns:
            처리 결과 딕셔너리
        """
        try:
            logger.info(f"🖼️ 이미지 파일 처리 시작: {file.filename} (detail={detail})")

            # 파일 내용 읽기
            await file.seek(0)
            file_content = await file.read()

            # 1단계: 로컬 OCR 시도 (EasyOCR)
            try:
                import easyocr
                from io import BytesIO
                from PIL import Image

                logger.info("🔍 로컬 OCR 시도 (EasyOCR)")

                # EasyOCR Reader 초기화 (한글, 영어)
                reader = easyocr.Reader(['ko', 'en'], gpu=False, verbose=False)

                # 이미지 바이트를 numpy array로 변환
                img = Image.open(BytesIO(file_content))
                import numpy as np
                img_array = np.array(img)

                # OCR 실행
                result = reader.readtext(img_array)

                if result and len(result) > 0:
                    # 결과를 위치별로 정렬 (위→아래, 왼쪽→오른쪽)
                    sorted_result = sorted(result, key=lambda x: (x[0][0][1], x[0][0][0]))
                    text = '\n'.join([item[1] for item in sorted_result])

                    # 최소 20자 이상 추출되면 성공으로 간주
                    if len(text.strip()) >= 20:
                        logger.info(f"✅ 로컬 OCR 성공: {len(text)}자 추출 (비용 0원)")
                        logger.debug(f"📝 추출된 텍스트 (처음 200자): {text[:200]}")

                        return {
                            "success": True,
                            "type": "IMAGE",
                            "method": "easyocr-local",
                            "text": text,
                            "char_count": len(text),
                            "cost_estimate": "무료 (로컬 OCR)"
                        }
                    else:
                        logger.warning(f"⚠️ 로컬 OCR 텍스트 부족: {len(text)}자 → Vision API로 전환")

                else:
                    logger.warning("⚠️ 로컬 OCR 결과 없음 → Vision API로 전환")

            except ImportError:
                logger.warning("⚠️ EasyOCR 미설치 → Vision API로 전환")
            except Exception as ocr_error:
                logger.warning(f"⚠️ 로컬 OCR 실패: {str(ocr_error)} → Vision API로 전환")

            # 2단계: Vision API 호출 (프롬프트 개선)
            import base64

            logger.info("🌐 OpenAI Vision API 호출")

            # Base64 인코딩
            img_base64 = base64.b64encode(file_content).decode("utf-8")

            # Vision API 호출 (법률 맥락 강조)
            response = await self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": """당신은 법원 제출용 증거 자료 분석 전문가입니다.
이 이미지는 법적 소송 증거로 사용될 문서입니다.
이미지 내 모든 텍스트, 대화 내용, 시간, 발신자 정보를 빠짐없이 정확하게 추출하세요.

형식:
- 문서/대화의 경우: [발신자/작성자] [시간] 내용
- 일반 문서의 경우: 텍스트를 원본 구조 그대로 추출"""
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{img_base64}",
                                    "detail": detail
                                }
                            }
                        ]
                    }
                ],
                max_tokens=2000
            )

            text = response.choices[0].message.content or ""

            # OpenAI가 거절했는지 확인
            if "죄송하지만" in text or "분석할 수 없습니다" in text or len(text.strip()) < 20:
                logger.warning(f"⚠️ OpenAI Vision 거절 또는 결과 부족: {text[:100]}")
                return {
                    "success": False,
                    "type": "IMAGE",
                    "method": "openai-vision-rejected",
                    "text": text,
                    "char_count": len(text),
                    "error": "Vision API가 텍스트 추출을 거절했습니다. 로컬 OCR을 사용하거나 다른 이미지를 시도하세요."
                }

            logger.info(f"✅ Vision API OCR 완료: {len(text)}자 추출 (detail={detail})")
            logger.debug(f"📝 추출된 텍스트 (처음 200자): {text[:200]}")

            return {
                "success": True,
                "type": "IMAGE",
                "method": f"openai-vision-{detail}",
                "text": text,
                "char_count": len(text),
                "cost_estimate": "저비용 (Vision API)" if detail == "low" else "중비용 (Vision API High)"
            }

        except Exception as e:
            logger.error(f"❌ 이미지 처리 실패: {str(e)}")
            return {
                "success": False,
                "type": "IMAGE",
                "error": str(e)
            }

    async def process(
        self,
        file: UploadFile,
        detail: DetailLevel = "high"
    ) -> Dict[str, Any]:
        """
        증거 파일 처리 메인 메서드

        Args:
            file: 업로드된 파일
            detail: Vision API detail 레벨 (이미지/이미지형 PDF용)

        Returns:
            처리 결과 딕셔너리
        """
        logger.info(f"🚀 증거 파일 처리 시작: {file.filename}")

        # 1. 파일 타입 식별
        file_type = self.identify_file_type(file)
        logger.info(f"📋 파일 타입: {file_type}")

        # 2. 타입별 처리
        if file_type == "AUDIO":
            return await self.process_audio(file)

        elif file_type == "PDF":
            return await self.process_pdf(file, detail)

        elif file_type == "IMAGE":
            return await self.process_image(file, detail)

        else:
            logger.error(f"❌ 지원하지 않는 파일 타입: {file_type}")
            return {
                "success": False,
                "type": "UNKNOWN",
                "error": f"Unsupported file type: {file_type}"
            }
