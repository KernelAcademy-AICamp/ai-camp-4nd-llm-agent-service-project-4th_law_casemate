import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Sparkles,
  Loader2,
  FileText,
  AlertCircle,
  Download,
  CheckCircle,
  XCircle,
} from "lucide-react";

interface Evidence {
  evidence_id: number;
  file_name: string;
  file_type: string;
  file_size: number;
  file_path: string;
  content: string | null;  // OCR/VLM/STT 결과
  starred: boolean;
  linked_case_ids: number[];
  category_id: number | null;
  created_at: string;
  uploader_id: number;
}

interface CaseData {
  case_id: number;
  name: string;
  description?: string;
  case_type?: string;
  status?: string;
}

interface AnalysisData {
  id: number;
  summary: string;
  legal_relevance: string;
  risk_level: string;
  ai_model: string;
  created_at: string;
}

export function EvidenceDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const caseId = searchParams.get('caseId'); // URL에서 caseId 추출

  // 상태 관리
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showInfo, setShowInfo] = useState(true);

  // 분석 상태 관리
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // 파일 미리보기 상태
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // 증거 정보 가져오기
  const fetchEvidence = async () => {
    if (!id) {
      setErrorMessage('인증이 필요합니다.');
      setIsLoadingEvidence(false);
      return;
    }

    // ID가 숫자인지 확인
    const evidenceIdNum = parseInt(id);
    if (isNaN(evidenceIdNum)) {
      setErrorMessage('잘못된 증거 ID입니다.');
      setIsLoadingEvidence(false);
      return;
    }

    setIsLoadingEvidence(true);
    setErrorMessage(null);

    try {
      const response = await apiFetch(`/api/v1/evidence/${evidenceIdNum}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('증거를 찾을 수 없습니다.');
        } else if (response.status === 401) {
          throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
        } else {
          throw new Error('증거 정보를 불러오는데 실패했습니다.');
        }
      }

      const data = await response.json();
      console.log('증거 정보:', data);
      setEvidence(data);
    } catch (error: any) {
      console.error('증거 정보 조회 실패:', error);
      setErrorMessage(error.message || '증거 정보를 불러오는데 실패했습니다.');
    } finally {
      setIsLoadingEvidence(false);
    }
  };

  // 사건 정보 가져오기 (옵셔널)
  const fetchCase = async () => {
    if (!caseId) return;

    const caseIdNum = parseInt(caseId);
    if (isNaN(caseIdNum)) return;

    try {
      const response = await apiFetch(`/api/v1/cases/${caseIdNum}`);

      if (response.ok) {
        const data = await response.json();
        console.log('사건 정보:', data);
        setCaseData(data);
      }
    } catch (error) {
      console.error('사건 정보 조회 실패:', error);
    }
  };

  // 분석 정보 조회
  const fetchAnalysis = async () => {
    if (!id) return;

    const evidenceIdNum = parseInt(id);
    if (isNaN(evidenceIdNum)) return;

    setIsLoadingAnalysis(true);
    try {
      const url = caseId
        ? `/api/v1/evidence/${evidenceIdNum}/analysis?case_id=${caseId}`
        : `/api/v1/evidence/${evidenceIdNum}/analysis`;

      const response = await apiFetch(url);

      if (response.ok) {
        const data = await response.json();
        console.log('분석 정보:', data);
        setHasAnalysis(data.has_analysis);
        setAnalysisData(data.analysis);

        // 자동 분석 트리거: 증거가 사건과 연결되어 있지만 분석이 없는 경우
        if (!data.has_analysis && evidence) {
          const isLinkedToCase = caseId || (evidence.linked_case_ids && evidence.linked_case_ids.length > 0);
          const hasContent = evidence.content && evidence.content.trim().length > 20;

          if (isLinkedToCase && hasContent) {
            console.log('🤖 증거가 사건과 연결되어 있지만 분석이 없습니다. 자동 분석을 시작합니다...');
            // 약간의 지연 후 자동 분석 시작 (UI 업데이트를 위해)
            setTimeout(() => {
              handleAnalyze();
            }, 500);
          }
        }
      }
    } catch (error) {
      console.error('분석 정보 조회 실패:', error);
    } finally {
      setIsLoadingAnalysis(false);
    }
  };

  // 분석 수행
  const handleAnalyze = async () => {
    if (!id) {
      setAnalysisMessage({ type: 'error', text: '로그인이 필요합니다.' });
      setTimeout(() => setAnalysisMessage(null), 3000);
      return;
    }

    const evidenceIdNum = parseInt(id);
    if (isNaN(evidenceIdNum)) {
      setAnalysisMessage({ type: 'error', text: '잘못된 증거 ID입니다.' });
      setTimeout(() => setAnalysisMessage(null), 3000);
      return;
    }

    setIsAnalyzing(true);
    setAnalysisMessage(null);
    try {
      const url = caseId
        ? `/api/v1/evidence/${evidenceIdNum}/analyze?case_id=${caseId}`
        : `/api/v1/evidence/${evidenceIdNum}/analyze`;

      const response = await apiFetch(url, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || '분석 실패');
      }

      const data = await response.json();
      console.log('분석 완료:', data);

      // 분석 결과 업데이트
      setHasAnalysis(true);
      setAnalysisData(data.analysis);

      // 성공 메시지 표시 (3초 후 자동 사라짐)
      const successMessage = caseId
        ? '사건 맥락을 고려한 분석이 완료되었습니다!'
        : '분석이 완료되었습니다!';
      setAnalysisMessage({ type: 'success', text: successMessage });
      setTimeout(() => setAnalysisMessage(null), 3000);
    } catch (error: any) {
      console.error('분석 실패:', error);
      setAnalysisMessage({ type: 'error', text: `분석 실패: ${error.message}` });
      setTimeout(() => setAnalysisMessage(null), 5000);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 파일 미리보기 URL 가져오기
  const fetchFilePreviewUrl = async () => {
    if (!evidence) return;

    setIsLoadingPreview(true);
    try {
      const response = await apiFetch(`/api/v1/evidence/${evidence.evidence_id}/url`);

      if (!response.ok) {
        throw new Error('파일 URL 생성 실패');
      }

      const data = await response.json();
      setFilePreviewUrl(data.signed_url);
    } catch (error) {
      console.error('파일 미리보기 URL 가져오기 실패:', error);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // 파일 다운로드
  const handleDownload = async () => {
    if (!evidence) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      // Signed URL 가져오기
      const response = await apiFetch(`/api/v1/evidence/${evidence.evidence_id}/url`);

      if (!response.ok) {
        throw new Error('파일 URL 생성 실패');
      }

      const data = await response.json();
      const signedUrl = data.signed_url;

      // fetch로 파일 다운로드
      const fileResponse = await fetch(signedUrl);
      if (!fileResponse.ok) {
        throw new Error('파일 다운로드 실패');
      }

      // Blob으로 변환
      const blob = await fileResponse.blob();

      // Blob URL 생성 및 다운로드
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = evidence.file_name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Blob URL 해제
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('파일 다운로드 실패:', error);
      alert(`파일 다운로드 실패: ${error}`);
    }
  };

  // 초기 로드 시 데이터 가져오기
  useEffect(() => {
    fetchEvidence();
    fetchCase();
  }, [id, caseId]);

  // 증거 정보가 로드되면 분석 정보 조회 및 파일 미리보기 URL 가져오기
  useEffect(() => {
    if (evidence) {
      fetchAnalysis();
      fetchFilePreviewUrl();
    }
  }, [evidence?.evidence_id]);

  // 로딩 중
  if (isLoadingEvidence) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 120px)' }}>
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">증거 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // 에러 발생
  if (errorMessage || !evidence) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 120px)' }}>
        <Card className="w-full max-w-md border-destructive/50">
          <CardContent className="pt-6">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">증거를 불러올 수 없습니다</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {errorMessage || '증거 정보를 찾을 수 없습니다.'}
              </p>
              <Button onClick={() => navigate(-1)} variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                돌아가기
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 파일 타입 확인 함수들
  const isImageFile = evidence.file_type.startsWith('image/');
  const isPdfFile = evidence.file_type === 'application/pdf';
  const isAudioFile = evidence.file_type.startsWith('audio/');
  const isVideoFile = evidence.file_type.startsWith('video/');

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            className="h-9 px-3 -ml-3 text-muted-foreground hover:text-foreground w-fit"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            돌아가기
          </Button>
          {caseData && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">사건:</span>
              <span className="text-sm font-medium">{caseData.name}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            className="h-8"
          >
            <Download className="h-3.5 w-3.5 mr-2" />
            다운로드
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInfo(!showInfo)}
            className="h-8"
          >
            {showInfo ? (
              <>
                <EyeOff className="h-3.5 w-3.5 mr-2" />
                정보 숨기기
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5 mr-2" />
                정보 보기
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Title Section */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{evidence.file_name}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDate(evidence.created_at)} · {evidence.file_type}
        </p>
      </div>

      {/* Main Content */}
      <div className="flex gap-6">
        {/* Content Viewer */}
        <div className={`flex-1 ${showInfo ? "w-2/3" : "w-full"}`}>
          <Card className="h-full border-border/60">
            <CardContent className="p-0">
              {isLoadingPreview ? (
                <div className="aspect-[4/3] bg-secondary/30 rounded-t-lg flex items-center justify-center">
                  <div className="text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">파일 로딩 중...</p>
                  </div>
                </div>
              ) : filePreviewUrl ? (
                <>
                  {/* 이미지 미리보기 */}
                  {isImageFile && (
                    <div className="bg-secondary/30 rounded-t-lg flex items-center justify-center p-4">
                      <img
                        src={filePreviewUrl}
                        alt={evidence.file_name}
                        className="max-h-[600px] w-auto object-contain rounded"
                        onError={(e) => {
                          console.error('이미지 로드 실패');
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  {/* PDF 미리보기 */}
                  {isPdfFile && (
                    <div className="bg-secondary/30 rounded-t-lg">
                      <iframe
                        src={filePreviewUrl}
                        className="w-full h-[600px] rounded-t-lg"
                        title={evidence.file_name}
                      />
                    </div>
                  )}

                  {/* 음성 파일 재생 */}
                  {isAudioFile && (
                    <div className="bg-secondary/30 rounded-t-lg p-8 flex flex-col items-center justify-center min-h-[400px]">
                      <div className="text-center mb-6">
                        <FileText className="h-16 w-16 mx-auto mb-4 opacity-50 text-muted-foreground" />
                        <p className="text-sm font-medium">{evidence.file_name}</p>
                        <p className="text-xs text-muted-foreground mt-1">{evidence.file_type}</p>
                      </div>
                      <audio
                        controls
                        className="w-full max-w-md"
                        preload="metadata"
                      >
                        <source src={filePreviewUrl} type={evidence.file_type} />
                        브라우저가 오디오 재생을 지원하지 않습니다.
                      </audio>
                    </div>
                  )}

                  {/* 비디오 파일 재생 */}
                  {isVideoFile && (
                    <div className="bg-secondary/30 rounded-t-lg p-4">
                      <video
                        controls
                        className="w-full max-h-[600px] rounded"
                        preload="metadata"
                      >
                        <source src={filePreviewUrl} type={evidence.file_type} />
                        브라우저가 비디오 재생을 지원하지 않습니다.
                      </video>
                    </div>
                  )}

                  {/* 기타 파일 */}
                  {!isImageFile && !isPdfFile && !isAudioFile && !isVideoFile && (
                    <div className="aspect-[4/3] bg-secondary/30 rounded-t-lg flex items-center justify-center">
                      <div className="text-center text-muted-foreground">
                        <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p className="text-sm font-medium">{evidence.file_name}</p>
                        <p className="text-xs mt-1">{evidence.file_type}</p>
                        <p className="text-xs mt-2">미리보기를 지원하지 않는 파일 형식입니다</p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="aspect-[4/3] bg-secondary/30 rounded-lg flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">{evidence.file_name}</p>
                    <p className="text-xs mt-1">{evidence.file_type}</p>
                    <p className="text-xs mt-2">파일을 불러올 수 없습니다</p>
                  </div>
                </div>
              )}

              {/* Content (OCR/VLM/STT 결과) */}
              {evidence.content && (
                <div className="p-6 border-t border-border/60">
                  <h3 className="text-sm font-medium mb-3">추출된 내용</h3>
                  <div className="bg-secondary/30 rounded-lg p-4">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {evidence.content}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Info Panel */}
        {showInfo && (
          <div className="w-1/3 space-y-4">
            {/* Evidence Info */}
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">증거 정보</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">파일명</p>
                  <p className="text-sm font-medium break-all">{evidence.file_name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">파일 유형</p>
                  <p className="text-sm font-medium">{evidence.file_type}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">파일 크기</p>
                  <p className="text-sm font-medium">{formatFileSize(evidence.file_size)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">업로드 날짜</p>
                  <p className="text-sm font-medium">{formatDate(evidence.created_at)}</p>
                </div>
                {evidence.linked_case_ids.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">연결된 사건</p>
                    <Badge variant="outline" className="text-xs font-normal">
                      {evidence.linked_case_ids.length}건
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* AI Analysis */}
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    AI 법적 분석
                  </CardTitle>
                  {!isLoadingAnalysis && (
                    <Badge
                      variant={hasAnalysis ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {hasAnalysis ? "분석완료" : "미분석"}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <Separator className="mb-4" />

                {/* 분석 메시지 표시 */}
                {analysisMessage && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg text-sm mb-4 ${
                    analysisMessage.type === 'success'
                      ? 'bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800'
                      : 'bg-[#EF4444]/5 dark:bg-[#EF4444]/10 text-[#EF4444] dark:text-[#EF4444] border border-[#EF4444]/20 dark:border-[#EF4444]/30'
                  }`}>
                    {analysisMessage.type === 'success' ? (
                      <CheckCircle className="h-4 w-4 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0" />
                    )}
                    <span>{analysisMessage.text}</span>
                  </div>
                )}

                {isLoadingAnalysis ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : hasAnalysis && analysisData ? (
                  <>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">요약</p>
                        <p className="text-sm leading-relaxed">{analysisData.summary}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">법적 관련성</p>
                        <p className="text-sm leading-relaxed">{analysisData.legal_relevance}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">위험도</p>
                        <Badge
                          variant={
                            analysisData.risk_level === 'high' ? 'destructive' :
                            analysisData.risk_level === 'medium' ? 'secondary' :
                            'default'
                          }
                          className="text-xs"
                        >
                          {analysisData.risk_level === 'high' ? '높음' :
                           analysisData.risk_level === 'medium' ? '보통' :
                           '낮음'}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-3"
                      onClick={handleAnalyze}
                      disabled={isAnalyzing}
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                          분석 중...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5 mr-2" />
                          다시 분석
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground text-center py-4">
                      아직 분석되지 않은 증거입니다.
                    </p>
                    <Button
                      variant="default"
                      size="sm"
                      className="w-full"
                      onClick={handleAnalyze}
                      disabled={isAnalyzing}
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                          분석 중...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5 mr-2" />
                          분석하기
                        </>
                      )}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
