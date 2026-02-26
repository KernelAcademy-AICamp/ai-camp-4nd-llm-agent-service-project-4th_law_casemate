import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText, Star, AlertTriangle, CheckCircle, ExternalLink,
  ChevronDown, ChevronUp, Loader2, ImageIcon, FileAudio, FileVideo,
} from "lucide-react";
import { apiFetch } from "@/lib/api";

interface EvidenceItem {
  id: number;
  file_name: string;
  file_type: string;
  doc_type: string;
  starred: boolean;
  evidence_date: string | null;
  description: string | null;
  has_analysis: boolean;
  analysis_summary: string | null;
  legal_relevance: string | null;
  risk_level: string | null;
}

interface Props {
  data: Record<string, unknown>[];
  caseId?: number;
}

interface CachedUrl {
  url: string;
  fetchedAt: number;
}

const RISK_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

const URL_CACHE_TTL = 50_000; // 50초 (서명 URL 만료 60초 전 재발급)

export function EvidenceListRenderer({ data, caseId }: Props) {
  const navigate = useNavigate();
  const items = data as unknown as EvidenceItem[];

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [urlCache, setUrlCache] = useState<Record<number, CachedUrl>>({});
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  const [errorIds, setErrorIds] = useState<Set<number>>(new Set());

  const fetchSignedUrl = useCallback(async (evidenceId: number) => {
    // 캐시 체크 (50초 TTL)
    const cached = urlCache[evidenceId];
    if (cached && Date.now() - cached.fetchedAt < URL_CACHE_TTL) return;

    setLoadingIds((prev) => new Set(prev).add(evidenceId));
    setErrorIds((prev) => {
      const next = new Set(prev);
      next.delete(evidenceId);
      return next;
    });

    try {
      const res = await apiFetch(`/api/v1/evidence/${evidenceId}/url`);
      const data = await res.json();
      setUrlCache((prev) => ({
        ...prev,
        [evidenceId]: { url: data.signed_url, fetchedAt: Date.now() },
      }));
    } catch {
      setErrorIds((prev) => new Set(prev).add(evidenceId));
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(evidenceId);
        return next;
      });
    }
  }, [urlCache]);

  const toggleExpand = useCallback((item: EvidenceItem) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
        fetchSignedUrl(item.id);
      }
      return next;
    });
  }, [fetchSignedUrl]);

  if (!items || items.length === 0) {
    return <p className="text-sm text-muted-foreground">연결된 증거가 없습니다.</p>;
  }

  return (
    <div className="space-y-2">
      {caseId && (
        <button
          onClick={() => navigate(`/cases/${caseId}`)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors border border-primary/20"
        >
          <span>사건 상세 페이지에서 보기</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
      {items.map((item) => {
        const isExpanded = expandedIds.has(item.id);
        const isLoading = loadingIds.has(item.id);
        const hasError = errorIds.has(item.id);
        const cached = urlCache[item.id];

        return (
          <div
            key={item.id}
            className="rounded-xl border border-border/50 bg-card p-3 space-y-1.5"
          >
            {/* 헤더 */}
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-semibold text-foreground truncate flex-1">
                {item.file_name}
              </span>
              {item.starred && <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 shrink-0" />}
              {item.risk_level && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${RISK_COLORS[item.risk_level] || ""}`}>
                  {item.risk_level === "high" ? "고위험" : item.risk_level === "medium" ? "주의" : "양호"}
                </span>
              )}
              <button
                onClick={() => toggleExpand(item)}
                className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center hover:bg-muted/60 transition-colors"
              >
                {isExpanded
                  ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                }
              </button>
            </div>

            {/* 메타 정보 */}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span>{item.doc_type}</span>
              {item.evidence_date && <span>{item.evidence_date}</span>}
              {item.has_analysis ? (
                <span className="flex items-center gap-0.5 text-green-600">
                  <CheckCircle className="h-2.5 w-2.5" /> 분석 완료
                </span>
              ) : (
                <span className="flex items-center gap-0.5 text-muted-foreground/60">
                  <AlertTriangle className="h-2.5 w-2.5" /> 미분석
                </span>
              )}
            </div>

            {item.description && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">{item.description}</p>
            )}

            {item.analysis_summary && (
              <div className="text-[11px] text-card-foreground bg-muted/30 rounded-lg px-2.5 py-1.5 leading-relaxed">
                {item.analysis_summary.slice(0, 200)}
                {item.analysis_summary.length > 200 && "..."}
              </div>
            )}

            {/* 확장 영역: 인라인 미리보기 */}
            {isExpanded && (
              <div className="pt-2 border-t border-border/30">
                {isLoading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                )}

                {hasError && (
                  <p className="text-xs text-destructive text-center py-2">
                    미리보기를 불러올 수 없습니다.
                  </p>
                )}

                {!isLoading && !hasError && cached && (
                  <FilePreview url={cached.url} fileType={item.file_type} fileName={item.file_name} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FilePreview({ url, fileType, fileName }: { url: string; fileType: string; fileName: string }) {
  if (fileType.startsWith("image/")) {
    return (
      <img
        src={url}
        alt={fileName}
        className="max-h-48 rounded-lg object-contain w-full bg-muted/20"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }

  if (fileType === "application/pdf") {
    return (
      <iframe
        src={url}
        title={fileName}
        className="w-full h-48 rounded-lg border border-border/30"
      />
    );
  }

  if (fileType.startsWith("audio/")) {
    return (
      <div className="flex items-center gap-2 py-1">
        <FileAudio className="h-4 w-4 text-muted-foreground shrink-0" />
        <audio controls preload="metadata" className="w-full h-8">
          <source src={url} type={fileType} />
          오디오를 재생할 수 없습니다.
        </audio>
      </div>
    );
  }

  if (fileType.startsWith("video/")) {
    return (
      <video controls preload="metadata" className="max-h-48 rounded-lg w-full">
        <source src={url} type={fileType} />
        비디오를 재생할 수 없습니다.
      </video>
    );
  }

  return (
    <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
      <ImageIcon className="h-4 w-4" />
      <span>미리보기를 지원하지 않는 파일 형식입니다 ({fileType})</span>
    </div>
  );
}
