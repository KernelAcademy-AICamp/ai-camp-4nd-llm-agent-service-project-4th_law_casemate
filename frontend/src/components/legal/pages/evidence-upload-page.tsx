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
  Loader2,
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

// // Sample folder tree structure
// const sampleFolders: FileFolder[] = [
//   { id: "root", name: "내 드라이브", parentId: null, expanded: true },
//   { id: "f1", name: "계약서류", parentId: "root", expanded: false },
//   { id: "f1-1", name: "임대차계약", parentId: "f1" },
//   { id: "f1-2", name: "용역계약", parentId: "f1" },
//   { id: "f2", name: "증거자료", parentId: "root", expanded: true },
//   { id: "f2-1", name: "사진", parentId: "f2" },
//   { id: "f2-2", name: "녹취록", parentId: "f2" },
//   { id: "f2-3", name: "채팅기록", parentId: "f2" },
//   { id: "f3", name: "서신/통지", parentId: "root" },
//   { id: "f4", name: "금융/거래", parentId: "root" },
//   { id: "f5", name: "진술서", parentId: "root" },
// ];

export function EvidenceUploadPage({
  cases: propCases,
}: EvidenceUploadPageProps) {
  const navigate = useNavigate();
  const { id: caseIdFromUrl } = useParams<{ id: string }>();
  const cases = propCases || sampleCases;
  const [selectedFolder, setSelectedFolder] = useState<string>("root");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [files, setFiles] = useState<ManagedFile[]>([]);
  const [folders, setFolders] = useState<FileFolder[]>([
    { id: "root", name: "전체", parentId: null, expanded: true }
  ]);
  const [dragOver, setDragOver] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedFileForLink, setSelectedFileForLink] = useState<ManagedFile | null>(null);
  const [selectedCaseForLink, setSelectedCaseForLink] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [sidebarView, setSidebarView] = useState<"folders" | "recent" | "starred">("folders");

  // 업로드 상태 관리
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });

  // 파일 목록 로딩 상태 관리
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // 카테고리 추가 Dialog 상태
  const [showAddCategoryDialog, setShowAddCategoryDialog] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [selectedParentFolder, setSelectedParentFolder] = useState<string>("root");

  // 삭제 확인 Dialog 상태
  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<ManagedFile | null>(null);

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

  // 증거 파일 목록 가져오기 함수
  const fetchEvidences = useCallback(async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    setIsLoadingFiles(true);
    try {
      const response = await fetch('http://localhost:8000/api/v1/evidence/list', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        console.log('증거 목록:', data);

        // API 응답을 ManagedFile 형식으로 변환
        const evidenceFiles: ManagedFile[] = data.files.map((evidence: any) => ({
          id: evidence.evidence_id.toString(),
          name: evidence.file_name,
          type: evidence.file_type || 'application/octet-stream',
          size: evidence.file_size || 0,
          folder: evidence.category_id ? `cat-${evidence.category_id}` : 'root',
          uploadedAt: evidence.created_at ? evidence.created_at.split('T')[0] : '',
          modifiedAt: evidence.created_at ? evidence.created_at.split('T')[0] : '',
          linkedCases: evidence.linked_case_ids ? evidence.linked_case_ids.map((id: number) => id.toString()) : [],
          starred: evidence.starred || false,
        }));

        setFiles(evidenceFiles);
      }
    } catch (error) {
      console.error('증거 목록 조회 실패:', error);
    } finally {
      setIsLoadingFiles(false);
    }
  }, []);

  // 초기 로드 시 증거 파일 목록 가져오기
  useEffect(() => {
    fetchEvidences();
  }, [fetchEvidences]);

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
      let uploadSuccessCount = 0;

      // 업로드 시작
      setIsUploading(true);
      setUploadProgress({ current: 0, total: droppedFiles.length });

      // 각 파일을 순차적으로 업로드
      for (let i = 0; i < droppedFiles.length; i++) {
        const file = droppedFiles[i];
        try {
          // FormData 생성
          const formData = new FormData();
          formData.append('file', file);

          // 선택된 폴더가 카테고리면 category_id 추가
          if (selectedFolder !== 'root') {
            const categoryId = parseInt(selectedFolder.replace('cat-', ''));
            formData.append('category_id', categoryId.toString());
          }

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
          uploadSuccessCount++;

          // 진행률 업데이트
          setUploadProgress({ current: i + 1, total: droppedFiles.length });
        } catch (error) {
          console.error(`파일 업로드 실패 (${file.name}):`, error);
          alert(`파일 업로드 실패: ${file.name}`);
        }
      }

      // 업로드 완료
      setIsUploading(false);

      // 업로드 성공한 파일이 있으면 목록 새로고침
      if (uploadSuccessCount > 0) {
        await fetchEvidences();
      }
    },
    [selectedFolder, fetchEvidences]
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFilesInput = e.target.files;
    if (!selectedFilesInput) return;

    const token = localStorage.getItem('access_token');
    const filesArray = Array.from(selectedFilesInput);
    let uploadSuccessCount = 0;

    // 업로드 시작
    setIsUploading(true);
    setUploadProgress({ current: 0, total: filesArray.length });

    // 각 파일을 순차적으로 업로드
    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      try {
        // FormData 생성
        const formData = new FormData();
        formData.append('file', file);

        // 선택된 폴더가 카테고리면 category_id 추가
        if (selectedFolder !== 'root') {
          const categoryId = parseInt(selectedFolder.replace('cat-', ''));
          formData.append('category_id', categoryId.toString());
        }

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
        uploadSuccessCount++;

        // 진행률 업데이트
        setUploadProgress({ current: i + 1, total: filesArray.length });
      } catch (error) {
        console.error(`파일 업로드 실패 (${file.name}):`, error);
        alert(`파일 업로드 실패: ${file.name}`);
      }
    }

    // 업로드 완료
    setIsUploading(false);

    // 업로드 성공한 파일이 있으면 목록 새로고침
    if (uploadSuccessCount > 0) {
      await fetchEvidences();
    }

    // input 초기화
    e.target.value = '';
  };

  const deleteFile = (fileId: string) => {
    // 파일 찾기
    const file = files.find(f => f.id === fileId);
    if (!file) return;

    // 삭제 확인 다이얼로그 표시
    setFileToDelete(file);
    setShowDeleteConfirmDialog(true);
  };

  const confirmDeleteFile = async () => {
    if (!fileToDelete) return;

    const token = localStorage.getItem('access_token');
    if (!token) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      const evidenceId = fileToDelete.id;

      // 백엔드 API 호출하여 파일 삭제
      const response = await fetch(`http://localhost:8000/api/v1/evidence/delete/${evidenceId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`삭제 실패: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('증거 삭제 성공:', data);

      // 증거 목록 새로고침
      await fetchEvidences();

      // 다이얼로그 닫기
      setShowDeleteConfirmDialog(false);
      setFileToDelete(null);

      // 선택된 파일 목록에서도 제거
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        next.delete(evidenceId);
        return next;
      });
    } catch (error) {
      console.error('증거 삭제 실패:', error);
      alert(`증거 삭제 실패: ${error}`);
    }
  };

  const toggleStar = async (fileId: string) => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      // 백엔드 API 호출하여 starred 토글
      const response = await fetch(`http://localhost:8000/api/v1/evidence/${fileId}/starred`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`즐겨찾기 토글 실패: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('즐겨찾기 토글 성공:', data);

      // 로컬 상태 업데이트
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, starred: data.starred } : f))
      );
    } catch (error) {
      console.error('즐겨찾기 토글 실패:', error);
      alert(`즐겨찾기 토글 실패: ${error}`);
    }
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

  const linkFileToCase = async () => {
    if (!selectedFileForLink || !selectedCaseForLink) return;

    const token = localStorage.getItem('access_token');
    if (!token) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      const evidenceId = selectedFileForLink.id;
      const caseId = selectedCaseForLink;

      // 백엔드 API 호출
      const response = await fetch(`http://localhost:8000/api/v1/evidence/${evidenceId}/link-case/${caseId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`연결 실패: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('사건 연결 성공:', data);

      // 증거 목록 새로고침
      await fetchEvidences();

      setShowLinkModal(false);
      setSelectedFileForLink(null);
      setSelectedCaseForLink("");
    } catch (error) {
      console.error('사건 연결 실패:', error);
      alert(`사건 연결 실패: ${error}`);
    }
  };

  const getCaseName = (caseId: string) => {
    const foundCase = cases.find((c) => c.id === caseId);
    return foundCase?.name || caseId;
  };

  // 단일 파일 다운로드
  const downloadFile = async (fileId: string, fileName: string) => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      // Signed URL 가져오기
      const response = await fetch(`http://localhost:8000/api/v1/evidence/${fileId}/url`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`URL 생성 실패: ${response.statusText}`);
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
      link.download = fileName;
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

  // 선택된 파일들 다운로드
  const downloadSelectedFiles = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      alert('로그인이 필요합니다.');
      return;
    }

    const selectedFilesList = files.filter((f) => selectedFiles.has(f.id));

    for (const file of selectedFilesList) {
      try {
        await downloadFile(file.id, file.name);
        // 각 다운로드 사이에 짧은 딜레이
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`파일 다운로드 실패 (${file.name}):`, error);
      }
    }
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

  const addCategory = () => {
    setShowAddCategoryDialog(true);
  };

  const handleCreateCategory = async () => {
    const token = localStorage.getItem('access_token');

    if (!token) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      const response = await fetch('http://localhost:8000/api/v1/evidence/categories', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: categoryName,
          parent_id: selectedParentFolder === 'root' ? null : parseInt(selectedParentFolder.replace('cat-', '')),
          order_index: 0
        })
      });

      if (!response.ok) {
        throw new Error(`카테고리 생성 실패: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('카테고리 생성 성공:', data);

      // 카테고리 목록 새로고침
      const categoriesResponse = await fetch('http://localhost:8000/api/v1/evidence/categories', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (categoriesResponse.ok) {
        const categoriesData = await categoriesResponse.json();
        const categoryFolders: FileFolder[] = categoriesData.categories.map((cat: any) => ({
          id: `cat-${cat.category_id}`,
          name: cat.name,
          parentId: cat.parent_id ? `cat-${cat.parent_id}` : 'root',
          expanded: false
        }));

        const allFolders: FileFolder[] = [
          { id: "root", name: "전체", parentId: null, expanded: true },
          ...categoryFolders
        ];

        setFolders(allFolders);
      }

      // Dialog 닫기 및 초기화
      setShowAddCategoryDialog(false);
      setCategoryName("");
      setSelectedParentFolder("root");
    } catch (error) {
      console.error('카테고리 생성 실패:', error);
      alert(`카테고리 생성 실패: ${error}`);
    }
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
            disabled={isUploading}
          />
          <Button
            size="sm"
            onClick={() => document.getElementById("file-upload-main")?.click()}
            disabled={isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                업로드 중...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-1.5" />
                업로드
              </>
            )}
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
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={addCategory}>
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
              <Button variant="outline" size="sm" onClick={downloadSelectedFiles}>
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
            onDragOver={isUploading ? undefined : handleDragOver}
            onDragLeave={isUploading ? undefined : handleDragLeave}
            onDrop={isUploading ? undefined : handleDrop}
            className={`flex-1 overflow-auto transition-colors rounded-lg ${
              dragOver && !isUploading ? "bg-secondary/50 border-2 border-dashed border-foreground/30" : ""
            } ${isUploading ? "opacity-60 pointer-events-none" : ""}`}
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
            ) : isLoadingFiles ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <Loader2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3 animate-spin" />
                  <p className="text-sm font-medium">파일 목록을 불러오는 중...</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    잠시만 기다려 주세요
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
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-28">업로드 날짜</th>
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
                                <DropdownMenuItem onClick={() => downloadFile(file.id, file.name)}>
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
                            <DropdownMenuItem onClick={() => downloadFile(file.id, file.name)}>
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

      {/* Add Category Dialog */}
      {showAddCategoryDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base">카테고리 추가</CardTitle>
              <CardDescription className="text-sm">
                새로운 증거 카테고리를 생성합니다
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="category-name" className="text-sm font-medium">
                  카테고리명 <span className="text-destructive">*</span>
                </label>
                <Input
                  id="category-name"
                  placeholder="예: 계약서류, 증거자료..."
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="parent-folder" className="text-sm font-medium">
                  상위 카테고리
                </label>
                <Select
                  value={selectedParentFolder}
                  onValueChange={setSelectedParentFolder}
                >
                  <SelectTrigger id="parent-folder">
                    <SelectValue placeholder="루트 (최상위)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="root">루트 (최상위)</SelectItem>
                    {folders
                      .filter((f) => f.id !== "root")
                      .map((folder) => (
                        <SelectItem key={folder.id} value={folder.id}>
                          {folder.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddCategoryDialog(false);
                    setCategoryName("");
                    setSelectedParentFolder("root");
                  }}
                >
                  취소
                </Button>
                <Button
                  onClick={handleCreateCategory}
                  disabled={!categoryName.trim()}
                >
                  만들기
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Upload Progress Modal */}
      {isUploading && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                파일 업로드 중
              </CardTitle>
              <CardDescription className="text-sm">
                파일을 업로드하는 중입니다. 잠시만 기다려 주세요.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">진행률</span>
                  <span className="font-medium">
                    {uploadProgress.current} / {uploadProgress.total}
                  </span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{
                      width: `${uploadProgress.total > 0 ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%`
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {uploadProgress.current === uploadProgress.total && uploadProgress.total > 0
                    ? "업로드 완료 중..."
                    : "파일을 업로드하고 있습니다..."}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirmDialog && fileToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base text-destructive">증거 파일 삭제</CardTitle>
              <CardDescription className="text-sm">
                이 작업은 되돌릴 수 없습니다
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm">다음 파일을 삭제하시겠습니까?</p>
                <div className="p-3 bg-muted rounded-md">
                  <p className="font-medium text-sm">{fileToDelete.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    크기: {(fileToDelete.size / 1024).toFixed(2)} KB
                  </p>
                  {fileToDelete.linkedCases && fileToDelete.linkedCases.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      연결된 사건: {fileToDelete.linkedCases.length}건
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  ※ 스토리지에서도 영구적으로 삭제되며, 연결된 사건 매핑도 함께 삭제됩니다.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteConfirmDialog(false);
                    setFileToDelete(null);
                  }}
                >
                  취소
                </Button>
                <Button
                  variant="destructive"
                  onClick={confirmDeleteFile}
                >
                  삭제
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
