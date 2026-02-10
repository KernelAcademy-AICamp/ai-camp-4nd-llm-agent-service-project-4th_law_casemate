"use client";

import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { type EvidenceData, sampleEvidenceByDate } from "@/lib/sample-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Sparkles,
  Loader2,
} from "lucide-react";

interface EvidenceDetailPageProps {
  evidence?: EvidenceData;
  allEvidence?: EvidenceData[];
}

interface AnalysisData {
  id: number;
  summary: string;
  legal_relevance: string;
  risk_level: string;
  ai_model: string;
  created_at: string;
}

export function EvidenceDetailPage({
  evidence: propEvidence,
  allEvidence: propAllEvidence,
}: EvidenceDetailPageProps) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const caseId = searchParams.get('caseId'); // URL에서 caseId 추출

  const allEvidence = propAllEvidence || Object.values(sampleEvidenceByDate).flat();
  const evidence = propEvidence || allEvidence.find(e => e.id === id) || allEvidence[0];

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showInfo, setShowInfo] = useState(true);

  // 분석 상태 관리
  const [hasAnalysis, setHasAnalysis] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(true);

  const currentIndex = allEvidence.findIndex((e) => e.id === evidence.id);
  const hasImages = evidence.images && evidence.images.length > 0;

  // 분석 정보 조회
  const fetchAnalysis = async () => {
    const token = localStorage.getItem('access_token');
    if (!token || !evidence.id) return;

    setIsLoadingAnalysis(true);
    try {
      // case_id가 있으면 쿼리 파라미터로 전달
      const url = caseId
        ? `http://localhost:8000/api/v1/evidence/${evidence.id}/analysis?case_id=${caseId}`
        : `http://localhost:8000/api/v1/evidence/${evidence.id}/analysis`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('분석 정보:', data);
        setHasAnalysis(data.has_analysis);
        setAnalysisData(data.analysis);
      }
    } catch (error) {
      console.error('분석 정보 조회 실패:', error);
    } finally {
      setIsLoadingAnalysis(false);
    }
  };

  // 분석 수행
  const handleAnalyze = async () => {
    const token = localStorage.getItem('access_token');
    if (!token || !evidence.id) {
      alert('로그인이 필요합니다.');
      return;
    }

    setIsAnalyzing(true);
    try {
      // case_id가 있으면 쿼리 파라미터로 전달
      const url = caseId
        ? `http://localhost:8000/api/v1/evidence/${evidence.id}/analyze?case_id=${caseId}`
        : `http://localhost:8000/api/v1/evidence/${evidence.id}/analyze`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
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

      alert(caseId
        ? '사건 맥락을 고려한 분석이 완료되었습니다!'
        : '분석이 완료되었습니다!');
    } catch (error: any) {
      console.error('분석 실패:', error);
      alert(`분석 실패: ${error.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 초기 로드 시 분석 정보 조회
  useEffect(() => {
    fetchAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence.id]);

  const handlePrevEvidence = () => {
    if (currentIndex > 0) {
      navigate(`/evidence/${allEvidence[currentIndex - 1].id}`);
      setCurrentImageIndex(0);
    }
  };

  const handleNextEvidence = () => {
    if (currentIndex < allEvidence.length - 1) {
      navigate(`/evidence/${allEvidence[currentIndex + 1].id}`);
      setCurrentImageIndex(0);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "폭언/모욕":
        return "bg-foreground text-background";
      case "허위사실":
        return "bg-destructive text-destructive-foreground";
      default:
        return "bg-secondary text-secondary-foreground";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Button
          variant="ghost"
          className="h-9 px-3 -ml-3 text-muted-foreground hover:text-foreground w-fit"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          돌아가기
        </Button>
        <div className="flex items-center gap-2">
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
          <Badge
            variant={evidence.status === "분석중" ? "secondary" : "default"}
            className="text-xs font-normal"
          >
            {evidence.status}
          </Badge>
        </div>
      </div>

      {/* Title Section */}
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{evidence.name}</h1>
        <p className="text-sm text-muted-foreground">
          {evidence.date} {evidence.time} · {evidence.category}
        </p>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrevEvidence}
          disabled={currentIndex === 0}
          className="h-8 bg-transparent"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          이전 증거
        </Button>
        <span className="text-xs text-muted-foreground">
          {currentIndex + 1} / {allEvidence.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleNextEvidence}
          disabled={currentIndex === allEvidence.length - 1}
          className="h-8 bg-transparent"
        >
          다음 증거
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Main Content */}
      <div className="flex gap-6">
        {/* Image Viewer */}
        <div className={`flex-1 ${showInfo ? "w-2/3" : "w-full"}`}>
          <Card className="h-full border-border/60">
            <CardContent className="p-0">
              {hasImages ? (
                <div className="space-y-4">
                  {/* Main Image */}
                  <div className="aspect-[4/3] bg-secondary/30 rounded-t-lg flex items-center justify-center relative">
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <span className="text-sm font-medium">{evidence.name}</span>
                    </div>
                  </div>

                  {/* Thumbnails */}
                  {evidence.images.length > 1 && (
                    <div className="flex gap-2 p-4 pt-0 overflow-x-auto">
                      {evidence.images.map((_, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setCurrentImageIndex(index)}
                          className={`w-16 h-16 rounded-md border flex-shrink-0 flex items-center justify-center bg-secondary/30 transition-colors ${index === currentImageIndex
                            ? "border-foreground"
                            : "border-border/60 hover:border-border"
                            }`}
                        >
                          <span className="text-xs text-muted-foreground">
                            {index + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="aspect-[4/3] bg-secondary/30 rounded-lg flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <p className="text-sm font-medium">{evidence.name}</p>
                    <p className="text-xs mt-1">오디오 파일</p>
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
                  <p className="text-sm font-medium">{evidence.name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">유형</p>
                  <p className="text-sm font-medium">{evidence.type}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">날짜/시간</p>
                  <p className="text-sm font-medium">
                    {evidence.date} {evidence.time}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">분류</p>
                  <Badge
                    className={`text-xs font-normal ${getCategoryColor(evidence.category)}`}
                  >
                    {evidence.category}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">상태</p>
                  <Badge variant="outline" className="text-xs font-normal">
                    {evidence.status}
                  </Badge>
                </div>
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
