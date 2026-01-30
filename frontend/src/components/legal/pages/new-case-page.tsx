"use client";

import { useNavigate } from "react-router-dom";
import React from "react";
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Upload,
  X,
  Plus,
  Calendar,
  File,
  Trash2,
  FolderOpen,
  FileText,
  ImageIcon,
  Music,
  Video,
  Link2,
  Check,
  ChevronRight,
  Folder,
} from "lucide-react";

interface NewCasePageProps { }

interface EvidenceItem {
  id: string;
  date: string;
  files: UploadedFile[];
  description: string;
}

interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  fromFileManager?: boolean;
  date?: string;
  description?: string;
}

interface FolderStructure {
  name: string;
  path: string;
  children?: FolderStructure[];
  files?: {
    id: string;
    name: string;
    type: string;
    size: number;
    uploadedAt: string;
  }[];
}

// 파일 관리의 폴더 구조 (계층형)
const folderStructure: FolderStructure[] = [
  {
    name: "계약서류",
    path: "계약서류",
    children: [
      {
        name: "임대차",
        path: "계약서류/임대차",
        files: [
          { id: "mf1", name: "임대차계약서_원본.pdf", type: "application/pdf", size: 2450000, uploadedAt: "2024-01-15" },
          { id: "mf2", name: "임대차계약서_스캔.pdf", type: "application/pdf", size: 1820000, uploadedAt: "2024-01-15" },
        ],
      },
      {
        name: "매매",
        path: "계약서류/매매",
        files: [
          { id: "mf9", name: "매매계약서.pdf", type: "application/pdf", size: 1920000, uploadedAt: "2024-01-10" },
        ],
      },
    ],
    files: [
      { id: "mf10", name: "계약일반_서류.pdf", type: "application/pdf", size: 890000, uploadedAt: "2024-01-08" },
    ],
  },
  {
    name: "증거자료",
    path: "증거자료",
    children: [
      {
        name: "사진",
        path: "증거자료/사진",
        files: [
          { id: "mf3", name: "현장사진_01.jpg", type: "image/jpeg", size: 3200000, uploadedAt: "2024-01-18" },
          { id: "mf4", name: "현장사진_02.jpg", type: "image/jpeg", size: 2980000, uploadedAt: "2024-01-18" },
          { id: "mf11", name: "피해사진_03.jpg", type: "image/jpeg", size: 2150000, uploadedAt: "2024-01-19" },
        ],
      },
      {
        name: "녹취",
        path: "증거자료/녹취",
        files: [
          { id: "mf5", name: "녹취록_20240120.mp3", type: "audio/mpeg", size: 15600000, uploadedAt: "2024-01-20" },
          { id: "mf12", name: "녹취록_20240125.mp3", type: "audio/mpeg", size: 12300000, uploadedAt: "2024-01-25" },
        ],
      },
      {
        name: "대화기록",
        path: "증거자료/대화기록",
        files: [
          { id: "mf7", name: "카카오톡_대화내역.pdf", type: "application/pdf", size: 5400000, uploadedAt: "2024-01-25" },
        ],
      },
    ],
  },
  {
    name: "서신/통지",
    path: "서신/통지",
    files: [
      { id: "mf6", name: "내용증명_발송본.pdf", type: "application/pdf", size: 890000, uploadedAt: "2024-01-22" },
      { id: "mf13", name: "내용증명_회신.pdf", type: "application/pdf", size: 720000, uploadedAt: "2024-01-28" },
    ],
  },
  {
    name: "금융/거래",
    path: "금융/거래",
    files: [
      { id: "mf8", name: "영수증_모음.pdf", type: "application/pdf", size: 1250000, uploadedAt: "2024-01-28" },
      { id: "mf14", name: "계좌이체내역.pdf", type: "application/pdf", size: 980000, uploadedAt: "2024-01-30" },
    ],
  },
];

export function NewCasePage({ }: NewCasePageProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<"info" | "evidence">("info");

  // 기본 정보 필드들
  const [caseName, setCaseName] = useState("");
  const [caseType, setCaseType] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientRole, setClientRole] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [incidentDateEnd, setIncidentDateEnd] = useState("");
  const [isIncidentPeriod, setIsIncidentPeriod] = useState(false);
  const [notificationDate, setNotificationDate] = useState("");
  const [notificationDateEnd, setNotificationDateEnd] = useState("");
  const [isNotificationPeriod, setIsNotificationPeriod] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [deadlineEnd, setDeadlineEnd] = useState("");
  const [isDeadlinePeriod, setIsDeadlinePeriod] = useState(false);
  const [consultationNote, setConsultationNote] = useState("");

  // 증거 업로드 관련
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([
    { id: "1", date: "", files: [], description: "" },
  ]);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);

  // 파일 관리에서 불러오기 관련
  const [selectedFolderPath, setSelectedFolderPath] = useState<string[]>([]);
  const [selectedManagedFiles, setSelectedManagedFiles] = useState<string[]>([]);
  const [linkedFiles, setLinkedFiles] = useState<UploadedFile[]>([]);
  const [managedDate, setManagedDate] = useState("");
  const [managedDescription, setManagedDescription] = useState("");

  const handleDragOver = useCallback((e: React.DragEvent, itemId: string) => {
    e.preventDefault();
    setDragOverItemId(itemId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverItemId(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, itemId: string) => {
    e.preventDefault();
    setDragOverItemId(null);

    const files = Array.from(e.dataTransfer.files);
    const uploadedFiles: UploadedFile[] = files.map((file) => ({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: file.name,
      type: file.type,
      size: file.size,
    }));

    setEvidenceItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, files: [...item.files, ...uploadedFiles] }
          : item
      )
    );
  }, []);

  const handleFileSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
    itemId: string
  ) => {
    const files = e.target.files;
    if (!files) return;

    const uploadedFiles: UploadedFile[] = Array.from(files).map((file) => ({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: file.name,
      type: file.type,
      size: file.size,
    }));

    setEvidenceItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, files: [...item.files, ...uploadedFiles] }
          : item
      )
    );
  };

  const removeFile = (itemId: string, fileId: string) => {
    setEvidenceItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, files: item.files.filter((f) => f.id !== fileId) }
          : item
      )
    );
  };

  const addEvidenceItem = () => {
    setEvidenceItems((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        date: "",
        files: [],
        description: "",
      },
    ]);
  };

  const removeEvidenceItem = (itemId: string) => {
    if (evidenceItems.length === 1) return;
    setEvidenceItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const updateEvidenceItem = (
    itemId: string,
    field: "date" | "description",
    value: string
  ) => {
    setEvidenceItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item
      )
    );
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return ImageIcon;
    if (type.startsWith("audio/")) return Music;
    if (type.startsWith("video/")) return Video;
    if (type.includes("pdf")) return FileText;
    return File;
  };

  // 폴더 경로를 따라가서 현재 폴더/파일 정보 가져오기
  const getCurrentFolderContent = () => {
    if (selectedFolderPath.length === 0) {
      return { folders: folderStructure, files: [] };
    }

    let current: FolderStructure[] = folderStructure;
    let currentFolder: FolderStructure | undefined;

    for (const pathPart of selectedFolderPath) {
      currentFolder = current.find((f) => f.name === pathPart);
      if (currentFolder?.children) {
        current = currentFolder.children;
      } else {
        current = [];
      }
    }

    return {
      folders: currentFolder?.children || [],
      files: currentFolder?.files || [],
    };
  };

  const handleFolderSelect = (level: number, folderName: string) => {
    const newPath = [...selectedFolderPath.slice(0, level), folderName];
    setSelectedFolderPath(newPath);
    setSelectedManagedFiles([]);
  };

  const getAvailableFoldersAtLevel = (level: number): FolderStructure[] => {
    if (level === 0) return folderStructure;

    let current: FolderStructure[] = folderStructure;
    for (let i = 0; i < level; i++) {
      const folder = current.find((f) => f.name === selectedFolderPath[i]);
      if (folder?.children) {
        current = folder.children;
      } else {
        return [];
      }
    }
    return current;
  };

  const toggleManagedFileSelection = (fileId: string) => {
    setSelectedManagedFiles((prev) =>
      prev.includes(fileId)
        ? prev.filter((id) => id !== fileId)
        : [...prev, fileId]
    );
  };

  const linkSelectedFiles = () => {
    const { files } = getCurrentFolderContent();
    const filesToLink: UploadedFile[] = files
      .filter((f) => selectedManagedFiles.includes(f.id))
      .map((f) => ({
        id: f.id + "-linked-" + Date.now(),
        name: f.name,
        type: f.type,
        size: f.size,
        fromFileManager: true,
        date: managedDate,
        description: managedDescription,
      }));

    setLinkedFiles((prev) => [...prev, ...filesToLink]);
    setSelectedManagedFiles([]);
    setManagedDate("");
    setManagedDescription("");
  };

  const removeLinkedFile = (fileId: string) => {
    setLinkedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const handleContinue = () => {
    setStep("evidence");
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!caseName.trim()) {
      alert("사건 명을 입력해주세요.");
      return;
    }

    setIsSubmitting(true);

    try {
      const token = localStorage.getItem("access_token");
      if (!token) {
        alert("로그인이 필요합니다.");
        navigate("/");
        return;
      }

      const response = await fetch("http://localhost:8000/api/v1/cases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: caseName,
          case_type: caseType || null,
          client_name: clientName || null,
          client_role: clientRole || null,
          incident_date: incidentDate || null,
          incident_date_end: isIncidentPeriod ? incidentDateEnd || null : null,
          notification_date: notificationDate || null,
          notification_date_end: isNotificationPeriod ? notificationDateEnd || null : null,
          deadline_at: deadline || null,
          deadline_at_end: isDeadlinePeriod ? deadlineEnd || null : null,
          description: consultationNote || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "사건 등록에 실패했습니다");
      }

      console.log("사건 등록 성공:", data);
      alert("사건이 등록되었습니다.");
      navigate("/cases");
    } catch (error) {
      console.error("사건 등록 실패:", error);
      const errorMessage =
        error instanceof Error ? error.message : "사건 등록 중 오류가 발생했습니다.";
      alert(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { folders: currentFolders, files: currentFiles } = getCurrentFolderContent();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <Button
          variant="ghost"
          className="h-9 px-3 -ml-3 text-muted-foreground hover:text-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          돌아가기
        </Button>

        <div>
          <h1 className="text-xl font-semibold tracking-tight">새 사건 등록</h1>
          <p className="text-sm text-muted-foreground mt-1">
            사건 정보와 증거 자료를 입력해주세요
          </p>
        </div>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${step === "info"
              ? "bg-foreground text-background"
              : "bg-foreground/20 text-foreground"
              }`}
          >
            1
          </div>
          <span
            className={`text-sm ${step === "info" ? "font-medium" : "text-muted-foreground"}`}
          >
            기본 정보
          </span>
        </div>
        <div className="flex-1 h-px bg-border" />
        <div className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${step === "evidence"
              ? "bg-foreground text-background"
              : "bg-secondary text-muted-foreground"
              }`}
          >
            2
          </div>
          <span
            className={`text-sm ${step === "evidence" ? "font-medium" : "text-muted-foreground"}`}
          >
            증거 업로드
          </span>
        </div>
      </div>

      {step === "info" ? (
        /* Step 1: Basic Info */
        <Card className="border-border/60">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-medium">기본 정보</CardTitle>
            <CardDescription className="text-sm">
              사건 및 의뢰인 정보를 입력해주세요. 모든 항목은 선택사항입니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* 사건명 + 사건 종류 (같은 줄) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="caseName" className="text-sm font-medium">
                  사건명
                </Label>
                <Input
                  id="caseName"
                  placeholder="예: 온라인 명예훼손 손해배상"
                  value={caseName}
                  onChange={(e) => setCaseName(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">사건 종류</Label>
                <Select value={caseType} onValueChange={setCaseType}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="종류 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="형사">형사</SelectItem>
                    <SelectItem value="민사">민사</SelectItem>
                    <SelectItem value="가사">가사</SelectItem>
                    <SelectItem value="행정">행정</SelectItem>
                    <SelectItem value="기타">기타</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* 의뢰인 이름 + 의뢰인 역할 (같은 줄) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="clientName" className="text-sm font-medium">
                  의뢰인 이름
                </Label>
                <Input
                  id="clientName"
                  placeholder="이름 입력"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">의뢰인 역할</Label>
                <Select value={clientRole} onValueChange={setClientRole}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="역할 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="고소인">고소인</SelectItem>
                    <SelectItem value="피고소인">피고소인</SelectItem>
                    <SelectItem value="피해자">피해자</SelectItem>
                    <SelectItem value="참고인">참고인</SelectItem>
                    <SelectItem value="원고">원고</SelectItem>
                    <SelectItem value="피고">피고</SelectItem>
                    <SelectItem value="기타">기타</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* 사건 발생일 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  사건 발생일
                </Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="incidentPeriod"
                    checked={isIncidentPeriod}
                    onCheckedChange={(checked) =>
                      setIsIncidentPeriod(checked === true)
                    }
                  />
                  <Label
                    htmlFor="incidentPeriod"
                    className="text-xs text-muted-foreground cursor-pointer"
                  >
                    기간으로 입력
                  </Label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={incidentDate}
                  onChange={(e) => setIncidentDate(e.target.value)}
                  className="h-10"
                />
                {isIncidentPeriod && (
                  <>
                    <span className="text-muted-foreground">~</span>
                    <Input
                      type="date"
                      value={incidentDateEnd}
                      onChange={(e) => setIncidentDateEnd(e.target.value)}
                      className="h-10"
                    />
                  </>
                )}
              </div>
            </div>

            {/* 인지일/통지일 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  인지일/통지일
                </Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="notificationPeriod"
                    checked={isNotificationPeriod}
                    onCheckedChange={(checked) =>
                      setIsNotificationPeriod(checked === true)
                    }
                  />
                  <Label
                    htmlFor="notificationPeriod"
                    className="text-xs text-muted-foreground cursor-pointer"
                  >
                    기간으로 입력
                  </Label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={notificationDate}
                  onChange={(e) => setNotificationDate(e.target.value)}
                  className="h-10"
                />
                {isNotificationPeriod && (
                  <>
                    <span className="text-muted-foreground">~</span>
                    <Input
                      type="date"
                      value={notificationDateEnd}
                      onChange={(e) => setNotificationDateEnd(e.target.value)}
                      className="h-10"
                    />
                  </>
                )}
              </div>
            </div>

            {/* 마감/기한 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  마감/기한
                </Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="deadlinePeriod"
                    checked={isDeadlinePeriod}
                    onCheckedChange={(checked) =>
                      setIsDeadlinePeriod(checked === true)
                    }
                  />
                  <Label
                    htmlFor="deadlinePeriod"
                    className="text-xs text-muted-foreground cursor-pointer"
                  >
                    기간으로 입력
                  </Label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="h-10"
                />
                {isDeadlinePeriod && (
                  <>
                    <span className="text-muted-foreground">~</span>
                    <Input
                      type="date"
                      value={deadlineEnd}
                      onChange={(e) => setDeadlineEnd(e.target.value)}
                      className="h-10"
                    />
                  </>
                )}
              </div>
            </div>

            <Separator />

            {/* 상담 내용 */}
            <div className="space-y-2">
              <Label htmlFor="consultationNote" className="text-sm font-medium">
                상담 내용
              </Label>
              <Textarea
                id="consultationNote"
                placeholder="상담 내용을 입력해 주세요."
                value={consultationNote}
                onChange={(e) => setConsultationNote(e.target.value)}
                rows={5}
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={handleContinue}>다음 단계</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Step 2: Evidence Upload - 2개의 카드로 분리 */
        <div className="space-y-6">
          {/* Card 1: 증거 업로드 */}
          <Card className="border-border/60">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-foreground/5 flex items-center justify-center">
                  <Upload className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base font-medium">증거 업로드</CardTitle>
                  <CardDescription className="text-sm">
                    파일을 직접 업로드하여 증거를 등록하세요
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {evidenceItems.map((item, index) => (
                <div
                  key={item.id}
                  className={`p-3 rounded-lg border border-border/60 bg-secondary/10 space-y-3 ${evidenceItems.length > 1 ? "relative" : ""
                    }`}
                >
                  {evidenceItems.length > 1 && (
                    <div className="absolute -top-2 -left-2">
                      <Badge variant="secondary" className="text-xs font-normal h-5 px-2">
                        {index + 1}
                      </Badge>
                    </div>
                  )}
                  {evidenceItems.length > 1 && (
                    <div className="absolute top-2 right-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeEvidenceItem(item.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}

                  {/* 드래그 앤 드롭 업로드 영역 - 최상단 (Compact) */}
                  <div
                    onDragOver={(e) => handleDragOver(e, item.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, item.id)}
                    className={`border-2 border-dashed rounded-md p-4 text-center transition-colors cursor-pointer ${dragOverItemId === item.id
                      ? "border-foreground bg-secondary/30"
                      : "border-border/60 hover:border-border hover:bg-secondary/20"
                      }`}
                    onClick={() =>
                      document.getElementById(`file-input-${item.id}`)?.click()
                    }
                  >
                    <div className="flex items-center justify-center gap-3">
                      <Upload className="h-5 w-5 text-muted-foreground" />
                      <div className="text-left">
                        <p className="text-sm font-medium">파일 드래그 또는 클릭하여 업로드</p>
                        <p className="text-xs text-muted-foreground">
                          이미지, PDF, 오디오, 비디오 지원
                        </p>
                      </div>
                    </div>
                    <input
                      type="file"
                      multiple
                      accept="image/*,application/pdf,audio/*,video/*"
                      onChange={(e) => handleFileSelect(e, item.id)}
                      className="hidden"
                      id={`file-input-${item.id}`}
                    />
                  </div>

                  {/* 업로드된 파일 목록 (Compact) */}
                  {item.files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {item.files.map((file) => {
                        const FileIcon = getFileIcon(file.type);
                        return (
                          <div
                            key={file.id}
                            className="flex items-center gap-1.5 px-2 py-1 rounded border border-border/60 bg-background text-xs"
                          >
                            <FileIcon className="h-3 w-3 text-muted-foreground" />
                            <span className="truncate max-w-[120px]">{file.name}</span>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => removeFile(item.id, file.id)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 증거 날짜 + 증거 설명 (한 줄로 Compact) */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">증거 날짜</Label>
                      <Input
                        type="date"
                        value={item.date}
                        onChange={(e) =>
                          updateEvidenceItem(item.id, "date", e.target.value)
                        }
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs text-muted-foreground">증거 설명</Label>
                      <Input
                        placeholder="예. 수집 경위, 증명 취지 등"
                        value={item.description}
                        onChange={(e) =>
                          updateEvidenceItem(item.id, "description", e.target.value)
                        }
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}

              {/* + 증거 추가 버튼 */}
              <Button
                variant="outline"
                size="sm"
                className="w-full bg-transparent"
                onClick={addEvidenceItem}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                증거 추가
              </Button>
            </CardContent>
          </Card>

          {/* Card 2: 파일 관리에서 불러오기 */}
          <Card className="border-border/60">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-foreground/5 flex items-center justify-center">
                  <FolderOpen className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <CardTitle className="text-base font-medium">파일 관리에서 불러오기</CardTitle>
                  <CardDescription className="text-sm">
                    기존에 업로드된 파일을 선택하여 사건에 연결하세요
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 폴더 경로 브레드크럼 */}
              {selectedFolderPath.length > 0 && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <button
                    onClick={() => setSelectedFolderPath([])}
                    className="hover:text-foreground transition-colors"
                  >
                    전체
                  </button>
                  {selectedFolderPath.map((folder, idx) => (
                    <React.Fragment key={folder}>
                      <ChevronRight className="h-3 w-3" />
                      <button
                        onClick={() => setSelectedFolderPath(selectedFolderPath.slice(0, idx + 1))}
                        className={`hover:text-foreground transition-colors ${idx === selectedFolderPath.length - 1 ? "text-foreground font-medium" : ""
                          }`}
                      >
                        {folder}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              )}

              {/* 드롭다운 폴더 선택기 */}
              <div className="flex flex-wrap gap-2">
                {/* 최상위 폴더 드롭다운 */}
                <Select
                  value={selectedFolderPath[0] || ""}
                  onValueChange={(value) => handleFolderSelect(0, value)}
                >
                  <SelectTrigger className="h-9 w-[180px]">
                    <div className="flex items-center gap-2">
                      <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                      <SelectValue placeholder="폴더 선택" />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {folderStructure.map((folder) => (
                      <SelectItem key={folder.path} value={folder.name}>
                        {folder.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* 동적으로 하위 폴더 드롭다운 추가 */}
                {selectedFolderPath.map((_, level) => {
                  const availableFolders = getAvailableFoldersAtLevel(level + 1);
                  if (availableFolders.length === 0) return null;

                  return (
                    <React.Fragment key={level}>
                      <ChevronRight className="h-4 w-4 text-muted-foreground self-center" />
                      <Select
                        value={selectedFolderPath[level + 1] || ""}
                        onValueChange={(value) => handleFolderSelect(level + 1, value)}
                      >
                        <SelectTrigger className="h-9 w-[180px]">
                          <div className="flex items-center gap-2">
                            <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                            <SelectValue placeholder="하위 폴더" />
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          {availableFolders.map((folder) => (
                            <SelectItem key={folder.path} value={folder.name}>
                              {folder.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* 파일 목록 */}
              {selectedFolderPath.length > 0 && (
                <div className="border border-border/60 rounded-lg overflow-hidden">
                  <div className="bg-secondary/30 px-4 py-2.5 border-b border-border/60">
                    <p className="text-sm font-medium">
                      {selectedFolderPath[selectedFolderPath.length - 1]} 폴더
                      {currentFiles.length > 0 && (
                        <span className="text-muted-foreground font-normal ml-2">
                          ({currentFiles.length}개 파일)
                        </span>
                      )}
                    </p>
                  </div>

                  {/* 하위 폴더 표시 */}
                  {currentFolders.length > 0 && (
                    <div className="border-b border-border/60">
                      {currentFolders.map((folder) => (
                        <button
                          key={folder.path}
                          onClick={() =>
                            setSelectedFolderPath([...selectedFolderPath, folder.name])
                          }
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/30 transition-colors text-left"
                        >
                          <Folder className="h-4 w-4 text-amber-500" />
                          <span className="text-sm">{folder.name}</span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* 파일 목록 */}
                  {currentFiles.length > 0 ? (
                    <ScrollArea className="max-h-64">
                      <div className="divide-y divide-border/60">
                        {currentFiles.map((file) => {
                          const FileIcon = getFileIcon(file.type);
                          const isSelected = selectedManagedFiles.includes(file.id);
                          const isAlreadyLinked = linkedFiles.some(
                            (lf) => lf.id.startsWith(file.id)
                          );

                          return (
                            <div
                              key={file.id}
                              onClick={() =>
                                !isAlreadyLinked && toggleManagedFileSelection(file.id)
                              }
                              className={`flex items-center gap-3 px-4 py-3 transition-colors ${isAlreadyLinked
                                ? "opacity-50 cursor-not-allowed"
                                : "cursor-pointer hover:bg-secondary/20"
                                } ${isSelected ? "bg-secondary/40" : ""}`}
                            >
                              <div
                                className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSelected
                                  ? "bg-foreground border-foreground"
                                  : isAlreadyLinked
                                    ? "border-border/60 bg-secondary/30"
                                    : "border-border hover:border-foreground/50"
                                  }`}
                              >
                                {isSelected && (
                                  <Check className="h-3 w-3 text-background" />
                                )}
                                {isAlreadyLinked && !isSelected && (
                                  <Check className="h-3 w-3 text-muted-foreground" />
                                )}
                              </div>
                              <FileIcon className="h-4 w-4 text-muted-foreground" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatFileSize(file.size)} · {file.uploadedAt}
                                </p>
                              </div>
                              {isAlreadyLinked && (
                                <Badge variant="outline" className="text-[10px] font-normal h-5">
                                  연결됨
                                </Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  ) : (
                    currentFolders.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                        이 폴더에 파일이 없습니다
                      </div>
                    )
                  )}

                  {/* 선택된 파일 연결 버튼 및 입력 필드 */}
                  {selectedManagedFiles.length > 0 && (
                    <div className="px-4 py-4 bg-secondary/20 border-t border-border/60 space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">증거 날짜</Label>
                          <Input
                            type="date"
                            value={managedDate}
                            onChange={(e) => setManagedDate(e.target.value)}
                            className="h-8 text-sm bg-background/50 border-border/40"
                          />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs text-muted-foreground">증거 설명</Label>
                          <Input
                            placeholder="예. 수집 경위, 증명 취지 등"
                            value={managedDescription}
                            onChange={(e) => setManagedDescription(e.target.value)}
                            className="h-8 text-sm bg-background/50 border-border/40"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {selectedManagedFiles.length}개 파일 선택됨
                        </span>
                        <Button size="sm" onClick={linkSelectedFiles}>
                          <Link2 className="h-3.5 w-3.5 mr-1.5" />
                          사건에 연결
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedFolderPath.length === 0 && (
                <div className="border-2 border-dashed border-border/60 rounded-lg p-8 text-center">
                  <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    폴더를 선택하여 파일을 탐색하세요
                  </p>
                </div>
              )}

              {/* 연결된 파일 목록 */}
              {linkedFiles.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                    연결된 파일 ({linkedFiles.length})
                  </Label>
                  <div className="space-y-1.5">
                    {linkedFiles.map((file) => {
                      const FileIcon = getFileIcon(file.type);
                      return (
                        <div
                          key={file.id}
                          className="flex items-center justify-between p-2.5 rounded-md border border-border/60 bg-secondary/20"
                        >
                          <div className="flex items-center gap-2.5">
                            <FileIcon className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm truncate max-w-[180px]">
                                  {file.name}
                                </p>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-normal h-5"
                                >
                                  <Link2 className="h-2.5 w-2.5 mr-1" />
                                  파일관리
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {formatFileSize(file.size)}
                                {(file.date || file.description) && (
                                  <span className="ml-1.5">
                                    · {file.date} {file.description && `· ${file.description}`}
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => removeLinkedFile(file.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Actions */}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep("info")} disabled={isSubmitting}>
              이전 단계
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? "등록 중..." : "사건 등록 완료"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
