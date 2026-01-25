"use client";

import React from "react";
import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Plus,
  FileText,
  File,
  Trash2,
  FolderOpen,
  Folder,
  FolderPlus,
  MoreVertical,
  Search,
  Grid,
  List,
  ImageIcon,
  Music,
  Video,
  Link2,
  ChevronRight,
  ChevronDown,
  Download,
  Star,
  Clock,
  HardDrive,
  Home,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate, useParams } from "react-router-dom";
import { type CaseData, sampleCases } from "@/lib/sample-data";

interface EvidenceUploadPageProps {
  cases?: CaseData[];
  preSelectedCaseId?: string;
}

interface ManagedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  folder: string;
  uploadedAt: string;
  modifiedAt: string;
  linkedCases?: string[];
  starred?: boolean;
}

interface FileFolder {
  id: string;
  name: string;
  parentId: string | null;
  expanded?: boolean;
}

// Sample folder tree structure
const sampleFolders: FileFolder[] = [
  { id: "root", name: "내 드라이브", parentId: null, expanded: true },
  { id: "f1", name: "계약서류", parentId: "root", expanded: false },
  { id: "f1-1", name: "임대차계약", parentId: "f1" },
  { id: "f1-2", name: "용역계약", parentId: "f1" },
  { id: "f2", name: "증거자료", parentId: "root", expanded: true },
  { id: "f2-1", name: "사진", parentId: "f2" },
  { id: "f2-2", name: "녹취록", parentId: "f2" },
  { id: "f2-3", name: "채팅기록", parentId: "f2" },
  { id: "f3", name: "서신/통지", parentId: "root" },
  { id: "f4", name: "금융/거래", parentId: "root" },
  { id: "f5", name: "진술서", parentId: "root" },
];

// Sample files
const sampleFiles: ManagedFile[] = [
  {
    id: "mf1",
    name: "계약서_원본.pdf",
    type: "application/pdf",
    size: 2450000,
    folder: "f1",
    uploadedAt: "2024-01-15",
    modifiedAt: "2024-01-15",
    linkedCases: ["CASE-001"],
    starred: true,
  },
  {
    id: "mf2",
    name: "임대차계약서_스캔.pdf",
    type: "application/pdf",
    size: 1820000,
    folder: "f1-1",
    uploadedAt: "2024-01-15",
    modifiedAt: "2024-01-16",
    linkedCases: ["CASE-001"],
  },
  {
    id: "mf3",
    name: "현장사진_001.jpg",
    type: "image/jpeg",
    size: 3200000,
    folder: "f2-1",
    uploadedAt: "2024-01-18",
    modifiedAt: "2024-01-18",
    linkedCases: ["CASE-001", "CASE-002"],
    starred: true,
  },
  {
    id: "mf4",
    name: "현장사진_002.jpg",
    type: "image/jpeg",
    size: 2980000,
    folder: "f2-1",
    uploadedAt: "2024-01-18",
    modifiedAt: "2024-01-18",
  },
  {
    id: "mf5",
    name: "녹취록_20240120.mp3",
    type: "audio/mpeg",
    size: 15600000,
    folder: "f2-2",
    uploadedAt: "2024-01-20",
    modifiedAt: "2024-01-20",
    linkedCases: ["CASE-002"],
  },
  {
    id: "mf6",
    name: "내용증명_발송본.pdf",
    type: "application/pdf",
    size: 890000,
    folder: "f3",
    uploadedAt: "2024-01-22",
    modifiedAt: "2024-01-22",
  },
  {
    id: "mf7",
    name: "카카오톡_대화내역.pdf",
    type: "application/pdf",
    size: 5400000,
    folder: "f2-3",
    uploadedAt: "2024-01-25",
    modifiedAt: "2024-01-25",
    linkedCases: ["CASE-001"],
  },
  {
    id: "mf8",
    name: "영수증_모음.pdf",
    type: "application/pdf",
    size: 1250000,
    folder: "f4",
    uploadedAt: "2024-01-28",
    modifiedAt: "2024-01-28",
  },
  {
    id: "mf9",
    name: "현장사진_003.jpg",
    type: "image/jpeg",
    size: 2750000,
    folder: "f2-1",
    uploadedAt: "2024-01-30",
    modifiedAt: "2024-01-30",
  },
  {
    id: "mf10",
    name: "통장거래내역.pdf",
    type: "application/pdf",
    size: 980000,
    folder: "f4",
    uploadedAt: "2024-02-01",
    modifiedAt: "2024-02-01",
  },
];

export function EvidenceUploadPage({
  cases: propCases,
}: EvidenceUploadPageProps) {
  const navigate = useNavigate();
  const { id: caseIdFromUrl } = useParams<{ id: string }>();
  const cases = propCases || sampleCases;
  const [selectedFolder, setSelectedFolder] = useState<string>("root");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [files, setFiles] = useState<ManagedFile[]>(sampleFiles);
  const [folders, setFolders] = useState<FileFolder[]>(sampleFolders);
  const [dragOver, setDragOver] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedFileForLink, setSelectedFileForLink] = useState<ManagedFile | null>(null);
  const [selectedCaseForLink, setSelectedCaseForLink] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [sidebarView, setSidebarView] = useState<"folders" | "recent" | "starred">("folders");

  // 카테고리 목록 가져오기
  useEffect(() => {
    const fetchCategories = async () => {
      const token = localStorage.getItem('access_token');
      if (!token) return;

      try {
        const response = await fetch('http://localhost:8000/api/v1/evidence/categories', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          console.log('카테고리 목록:', data);

          // API 응답을 FileFolder 형식으로 변환
          const categoryFolders: FileFolder[] = data.categories.map((cat: any) => ({
            id: `cat-${cat.category_id}`,
            name: cat.name,
            parentId: cat.parent_id ? `cat-${cat.parent_id}` : 'root',
            expanded: false
          }));

          // root 폴더 추가
          const allFolders: FileFolder[] = [
            { id: "root", name: "전체", parentId: null, expanded: true },
            ...categoryFolders
          ];

          setFolders(allFolders);
        }
      } catch (error) {
        console.error('카테고리 목록 조회 실패:', error);
      }
    };

    fetchCategories();
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      const droppedFiles = Array.from(e.dataTransfer.files);
      const token = localStorage.getItem('access_token');
      const today = new Date().toISOString().split("T")[0];
      const uploadedFiles: ManagedFile[] = [];

      // 각 파일을 순차적으로 업로드
      for (const file of droppedFiles) {
        try {
          // FormData 생성
          const formData = new FormData();
          formData.append('file', file);

          // 백엔드 API 호출
          const response = await fetch('http://localhost:8000/api/v1/evidence/upload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            },
            body: formData
          });

          if (!response.ok) {
            throw new Error(`업로드 실패: ${response.statusText}`);
          }

          const data = await response.json();
          console.log('업로드 API 응답:', data);

          // 성공한 파일만 목록에 추가
          uploadedFiles.push({
            id: data.evidence_id.toString(),
            name: file.name,
            type: file.type,
            size: file.size,
            folder: selectedFolder,
            uploadedAt: today,
            modifiedAt: today,
          });
        } catch (error) {
          console.error(`파일 업로드 실패 (${file.name}):`, error);
          alert(`파일 업로드 실패: ${file.name}`);
        }
      }

      // 업로드 성공한 파일들을 목록에 추가
      if (uploadedFiles.length > 0) {
        setFiles((prev) => [...prev, ...uploadedFiles]);
      }
    },
    [selectedFolder]
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFilesInput = e.target.files;
    if (!selectedFilesInput) return;

    const token = localStorage.getItem('access_token');
    const today = new Date().toISOString().split("T")[0];
    const uploadedFiles: ManagedFile[] = [];

    // 각 파일을 순차적으로 업로드
    for (const file of Array.from(selectedFilesInput)) {
      try {
        // FormData 생성
        const formData = new FormData();
        formData.append('file', file);

        // 백엔드 API 호출
        const response = await fetch('http://localhost:8000/api/v1/evidence/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });

        if (!response.ok) {
          throw new Error(`업로드 실패: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('업로드 API 응답:', data);

        // 성공한 파일만 목록에 추가
        uploadedFiles.push({
          id: data.evidence_id.toString(),
          name: file.name,
          type: file.type,
          size: file.size,
          folder: selectedFolder,
          uploadedAt: today,
          modifiedAt: today,
        });
      } catch (error) {
        console.error(`파일 업로드 실패 (${file.name}):`, error);
        alert(`파일 업로드 실패: ${file.name}`);
      }
    }

    // 업로드 성공한 파일들을 목록에 추가
    if (uploadedFiles.length > 0) {
      setFiles((prev) => [...prev, ...uploadedFiles]);
    }
  };

  const deleteFile = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });
  };

  const toggleStar = (fileId: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, starred: !f.starred } : f))
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

  const toggleFolderExpanded = (folderId: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, expanded: !f.expanded } : f))
    );
  };

  const getChildFolders = (parentId: string | null): FileFolder[] => {
    return folders.filter((f) => f.parentId === parentId);
  };

  const hasChildren = (folderId: string): boolean => {
    return folders.some((f) => f.parentId === folderId);
  };

  const getFolderPath = (folderId: string): FileFolder[] => {
    const path: FileFolder[] = [];
    let current = folders.find((f) => f.id === folderId);
    while (current) {
      path.unshift(current);
      current = current.parentId ? folders.find((f) => f.id === current?.parentId) : undefined;
    }
    return path;
  };

  const getFilesInFolder = (folderId: string): ManagedFile[] => {
    // Include files from this folder and all child folders
    const childFolderIds = new Set<string>();
    const collectChildFolders = (parentId: string) => {
      childFolderIds.add(parentId);
      folders
        .filter((f) => f.parentId === parentId)
        .forEach((f) => collectChildFolders(f.id));
    };
    collectChildFolders(folderId);
    return files.filter((f) => childFolderIds.has(f.folder));
  };

  const filteredFiles = (() => {
    let result = files;

    if (sidebarView === "starred") {
      result = files.filter((f) => f.starred);
    } else if (sidebarView === "recent") {
      result = [...files].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 20);
    } else if (selectedFolder !== "root") {
      result = getFilesInFolder(selectedFolder);
    }

    if (searchQuery) {
      result = result.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return result;
  })();

  const openLinkModal = (file: ManagedFile) => {
    setSelectedFileForLink(file);
    setShowLinkModal(true);
  };

  const linkFileToCase = () => {
    if (!selectedFileForLink || !selectedCaseForLink) return;

    setFiles((prev) =>
      prev.map((f) =>
        f.id === selectedFileForLink.id
          ? {
            ...f,
            linkedCases: [
              ...(f.linkedCases || []),
              selectedCaseForLink,
            ].filter((v, i, a) => a.indexOf(v) === i),
          }
          : f
      )
    );
    setShowLinkModal(false);
    setSelectedFileForLink(null);
    setSelectedCaseForLink("");
  };

  const getCaseName = (caseId: string) => {
    const foundCase = cases.find((c) => c.id === caseId);
    return foundCase?.name || caseId;
  };

  const toggleFileSelection = (fileId: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const selectAllFiles = () => {
    if (selectedFiles.size === filteredFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(filteredFiles.map((f) => f.id)));
    }
  };

  const deleteSelectedFiles = () => {
    setFiles((prev) => prev.filter((f) => !selectedFiles.has(f.id)));
    setSelectedFiles(new Set());
  };

  const renderFolderTree = (parentId: string | null, depth: number = 0) => {
    const childFolders = getChildFolders(parentId);
    if (childFolders.length === 0) return null;

    return (
      <div className={depth > 0 ? "ml-4" : ""}>
        {childFolders.map((folder) => {
          const isExpanded = folder.expanded;
          const hasChildFolders = hasChildren(folder.id);
          const isSelected = selectedFolder === folder.id && sidebarView === "folders";
          const fileCount = files.filter((f) => f.folder === folder.id).length;

          return (
            <div key={folder.id}>
              <button
                type="button"
                onClick={() => {
                  setSidebarView("folders");
                  setSelectedFolder(folder.id);
                }}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors group ${isSelected
                  ? "bg-secondary text-foreground font-medium"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  }`}
              >
                {hasChildFolders ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFolderExpanded(folder.id);
                    }}
                    className="p-0.5 hover:bg-secondary rounded"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : (
                  <span className="w-4" />
                )}
                {isSelected || isExpanded ? (
                  <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="truncate flex-1 text-left">{folder.name}</span>
                {fileCount > 0 && (
                  <span className="text-xs text-muted-foreground/70">{fileCount}</span>
                )}
              </button>
              {isExpanded && hasChildFolders && renderFolderTree(folder.id, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };

  const currentFolderPath = getFolderPath(selectedFolder);

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col gap-4">
      {/* Back Button */}
      <div className="pb-2">
        <Button
          variant="ghost"
          className="h-9 px-3 -ml-3 text-muted-foreground hover:text-foreground"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          이전으로
        </Button>
      </div>

      {/* Top Toolbar */}
      <div className="flex items-center justify-between pb-4 border-b border-border/60">
        <div className="flex items-center gap-3">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() => {
                setSidebarView("folders");
                setSelectedFolder("root");
              }}
              className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            >
              <HardDrive className="h-4 w-4" />
              <span>내 드라이브</span>
            </button>
            {sidebarView === "folders" && selectedFolder !== "root" && (
              <>
                {currentFolderPath.slice(1).map((folder, idx) => (
                  <React.Fragment key={folder.id}>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                    <button
                      type="button"
                      onClick={() => setSelectedFolder(folder.id)}
                      className={`px-2 py-1 rounded hover:bg-secondary transition-colors ${idx === currentFolderPath.length - 2
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                      {folder.name}
                    </button>
                  </React.Fragment>
                ))}
              </>
            )}
            {sidebarView === "starred" && (
              <>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                <span className="px-2 py-1 text-foreground font-medium">중요 파일</span>
              </>
            )}
            {sidebarView === "recent" && (
              <>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
                <span className="px-2 py-1 text-foreground font-medium">최근 항목</span>
              </>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="파일 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          {/* View Toggle */}
          <div className="flex items-center border border-border/60 rounded-md">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-r-none"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-l-none border-l border-border/60"
              onClick={() => setViewMode("grid")}
            >
              <Grid className="h-4 w-4" />
            </Button>
          </div>
          {/* Upload Button */}
          <input
            type="file"
            multiple
            accept="image/*,application/pdf,audio/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
            id="file-upload-main"
          />
          <Button
            size="sm"
            onClick={() => document.getElementById("file-upload-main")?.click()}
          >
            <Upload className="h-4 w-4 mr-1.5" />
            업로드
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-0 mt-4 min-h-0">
        {/* Sidebar */}
        <div className="w-56 shrink-0 pr-4 border-r border-border/60">
          <div className="space-y-1">
            {/* Quick Access */}
            <button
              type="button"
              onClick={() => {
                setSidebarView("folders");
                setSelectedFolder("root");
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${sidebarView === "folders" && selectedFolder === "root"
                ? "bg-secondary text-foreground font-medium"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                }`}
            >
              <Home className="h-4 w-4" />
              <span>내 드라이브</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarView("recent")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${sidebarView === "recent"
                ? "bg-secondary text-foreground font-medium"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                }`}
            >
              <Clock className="h-4 w-4" />
              <span>최근 항목</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarView("starred")}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${sidebarView === "starred"
                ? "bg-secondary text-foreground font-medium"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                }`}
            >
              <Star className="h-4 w-4" />
              <span>중요 파일</span>
            </button>
          </div>

          {/* Folder Tree */}
          <div className="mt-4 pt-4 border-t border-border/60">
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">폴더</span>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-0.5">
              {renderFolderTree("root")}
            </div>
          </div>

          {/* Storage Info */}
          <div className="mt-4 pt-4 border-t border-border/60 px-2">
            <div className="text-xs text-muted-foreground mb-2">저장 공간</div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div className="h-full w-1/3 bg-foreground/60 rounded-full" />
            </div>
            <div className="text-xs text-muted-foreground mt-1.5">3.2 GB / 10 GB 사용</div>
          </div>
        </div>

        {/* File Area */}
        <div className="flex-1 pl-4 flex flex-col min-h-0">
          {/* Bulk Actions Bar */}
          {selectedFiles.size > 0 && (
            <div className="flex items-center gap-3 pb-3 border-b border-border/60 mb-3">
              <span className="text-sm text-muted-foreground">
                {selectedFiles.size}개 선택됨
              </span>
              <Button variant="outline" size="sm" onClick={deleteSelectedFiles}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                삭제
              </Button>
              <Button variant="outline" size="sm">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                다운로드
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedFiles(new Set())}
              >
                선택 해제
              </Button>
            </div>
          )}

          {/* Drop Zone (when dragging) */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex-1 overflow-auto transition-colors rounded-lg ${dragOver ? "bg-secondary/50 border-2 border-dashed border-foreground/30" : ""
              }`}
          >
            {dragOver ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm font-medium">파일을 여기에 놓으세요</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    "{folders.find((f) => f.id === selectedFolder)?.name || "내 드라이브"}" 폴더에 업로드됩니다
                  </p>
                </div>
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {searchQuery ? "검색 결과가 없습니다" : "폴더가 비어있습니다"}
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    파일을 드래그하여 업로드하세요
                  </p>
                </div>
              </div>
            ) : viewMode === "list" ? (
              /* List View */
              <div className="border border-border/60 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-secondary/30 border-b border-border/60">
                      <th className="w-10 px-3 py-2">
                        <Checkbox
                          checked={selectedFiles.size === filteredFiles.length && filteredFiles.length > 0}
                          onCheckedChange={selectAllFiles}
                        />
                      </th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">이름</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-28">수정한 날짜</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-20">크기</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-32">연결된 사건</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.map((file) => {
                      const FileIcon = getFileIcon(file.type);
                      const isSelected = selectedFiles.has(file.id);
                      return (
                        <tr
                          key={file.id}
                          className={`border-b border-border/40 hover:bg-secondary/20 transition-colors ${isSelected ? "bg-secondary/30" : ""
                            }`}
                        >
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleFileSelection(file.id)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded bg-secondary/50 flex items-center justify-center shrink-0">
                                <FileIcon className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <span className="font-medium truncate">{file.name}</span>
                              {file.starred && (
                                <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{file.modifiedAt}</td>
                          <td className="px-3 py-2 text-muted-foreground">{formatFileSize(file.size)}</td>
                          <td className="px-3 py-2">
                            {file.linkedCases && file.linkedCases.length > 0 ? (
                              <div className="flex items-center gap-1">
                                <Link2 className="h-3 w-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                  {file.linkedCases.length}건
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground/50">-</span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => toggleStar(file.id)}>
                                  <Star className="h-4 w-4 mr-2" />
                                  {file.starred ? "중요 해제" : "중요 표시"}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openLinkModal(file)}>
                                  <Link2 className="h-4 w-4 mr-2" />
                                  사건에 연결
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                  <Download className="h-4 w-4 mr-2" />
                                  다운로드
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => deleteFile(file.id)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  삭제
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Grid View */
              <div className="grid grid-cols-5 gap-3">
                {filteredFiles.map((file) => {
                  const FileIcon = getFileIcon(file.type);
                  const isSelected = selectedFiles.has(file.id);
                  return (
                    <div
                      key={file.id}
                      onClick={() => toggleFileSelection(file.id)}
                      className={`group relative p-3 rounded-lg border transition-all cursor-pointer ${isSelected
                        ? "border-foreground/30 bg-secondary/40"
                        : "border-border/60 hover:border-border hover:bg-secondary/20"
                        }`}
                    >
                      {/* Selection Checkbox */}
                      <div className={`absolute top-2 left-2 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleFileSelection(file.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      {/* Star */}
                      {file.starred && (
                        <div className="absolute top-2 right-2">
                          <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                        </div>
                      )}
                      {/* Menu */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => toggleStar(file.id)}>
                              <Star className="h-4 w-4 mr-2" />
                              {file.starred ? "중요 해제" : "중요 표시"}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openLinkModal(file)}>
                              <Link2 className="h-4 w-4 mr-2" />
                              사건에 연결
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => deleteFile(file.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              삭제
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {/* File Icon */}
                      <div className="w-12 h-12 mx-auto rounded-lg bg-secondary/50 flex items-center justify-center mb-2 mt-4">
                        <FileIcon className="h-6 w-6 text-muted-foreground" />
                      </div>
                      {/* File Name */}
                      <p className="text-sm font-medium text-center truncate px-1">{file.name}</p>
                      <p className="text-xs text-muted-foreground text-center mt-0.5">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Link to Case Modal */}
      {showLinkModal && selectedFileForLink && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base">사건에 연결</CardTitle>
              <CardDescription className="text-sm">
                "{selectedFileForLink.name}" 파일을 연결할 사건을 선택하세요
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={selectedCaseForLink}
                onValueChange={setSelectedCaseForLink}
              >
                <SelectTrigger>
                  <SelectValue placeholder="사건을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {cases.map((caseItem) => (
                    <SelectItem key={caseItem.id} value={caseItem.id}>
                      {caseItem.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowLinkModal(false);
                    setSelectedFileForLink(null);
                  }}
                >
                  취소
                </Button>
                <Button onClick={linkFileToCase} disabled={!selectedCaseForLink}>
                  연결하기
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
