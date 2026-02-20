import React from "react";
import { useState, useCallback, useEffect, useRef } from "react";
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
  ArrowLeft,
  Upload,
  Plus,
  FileText,
  File,
  Trash2,
  FolderOpen,
  Folder,
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
  Loader2,
  Briefcase,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "@/lib/api";
interface EvidenceUploadPageProps {
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

interface DocumentItem {
  id: number;
  case_id: number;
  title: string;
  document_type: string;
  updated_at: string | null;
}

interface CaseFolder {
  id: number;
  title: string;
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

export function EvidenceUploadPage({}: EvidenceUploadPageProps) {
  const navigate = useNavigate();
  // 페이지 모드: 증거 파일 vs 문서
  const [pageMode, setPageMode] = useState<"evidence" | "documents">("evidence");
  const [filterMode, setFilterMode] = useState<"all" | "recent" | "starred">("all");

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
  const [filesToLink, setFilesToLink] = useState<string[]>([]);
  const [selectedCaseForLink, setSelectedCaseForLink] = useState("");
  const [caseSearchQuery, setCaseSearchQuery] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // 문서 state
  const [caseFolders, setCaseFolders] = useState<CaseFolder[]>([]);
  const [selectedCaseFolder, setSelectedCaseFolder] = useState<number | null>(null);
  const [caseDocuments, setCaseDocuments] = useState<DocumentItem[]>([]);
  const [allDocuments, setAllDocuments] = useState<DocumentItem[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);

  // 업로드 상태 관리
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });

  // 파일 목록 로딩 상태 관리
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // 인라인 폴더 생성 상태
  const [inlineNewFolderParentId, setInlineNewFolderParentId] = useState<string | null>(null);
  const [inlineNewFolderName, setInlineNewFolderName] = useState("");
  const creatingFolderRef = useRef(false);

  // 폴더 이름 변경 상태
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState("");
  const renamingRef = useRef(false);

  // 폴더 드래그 상태
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  // 폴더 컨텍스트 메뉴
  const [folderContextMenu, setFolderContextMenu] = useState<{ folderId: string; x: number; y: number } | null>(null);

  // 삭제 확인 Dialog 상태
  const [showDeleteConfirmDialog, setShowDeleteConfirmDialog] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<ManagedFile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // 카테고리 목록 가져오기
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const response = await apiFetch('/api/v1/evidence/categories');

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

  // 초기 데이터 가져오기 함수
  const fetchInitData = useCallback(async () => {
    console.log('fetchInitData 호출됨');

    setIsLoadingFiles(true);
    console.log('API 호출 시작: /api/v1/file-manager/init');

    try {
      const response = await apiFetch('/api/v1/file-manager/init');

      console.log('API 응답 상태:', response.status, response.ok);

      if (response.ok) {
        const data = await response.json();
        console.log('✅ 증거 목록:', data);

        // 카테고리 → 폴더
        const categoryFolders: FileFolder[] = data.categories.map((cat: any) => ({
          id: `cat-${cat.category_id}`,
          name: cat.name,
          parentId: cat.parent_id ? `cat-${cat.parent_id}` : 'root',
          expanded: false
        }));
        setFolders([
          { id: "root", name: "전체", parentId: null, expanded: true },
          ...categoryFolders
        ]);

        // 증거 파일
        const evidenceFiles: ManagedFile[] = data.files.map((ev: any) => ({
          id: ev.evidence_id.toString(),
          name: ev.file_name,
          type: ev.file_type || 'application/octet-stream',
          size: ev.file_size || 0,
          folder: ev.category_id ? `cat-${ev.category_id}` : 'root',
          uploadedAt: ev.created_at ? ev.created_at.split('T')[0] : '',
          modifiedAt: ev.created_at ? ev.created_at.split('T')[0] : '',
          linkedCases: ev.linked_case_ids ? ev.linked_case_ids.map((id: number) => id.toString()) : [],
          starred: ev.starred || false,
        }));
        setFiles(evidenceFiles);

        // 사건 폴더
        setCaseFolders(data.case_folders);

        // 전체 문서
        setAllDocuments(data.documents);
      }
    } catch (error) {
      console.error('통합 API 실패, 개별 API로 fallback:', error);
      // fallback: 개별 API 호출
      try {
        const [catRes, fileRes, caseRes, docRes] = await Promise.all([
          apiFetch('/api/v1/evidence/categories'),
          apiFetch('/api/v1/evidence/list'),
          apiFetch('/api/v1/cases'),
          apiFetch('/api/v1/documents/'),
        ]);

        if (catRes.ok) {
          const catData = await catRes.json();
          const categoryFolders: FileFolder[] = catData.categories.map((cat: any) => ({
            id: `cat-${cat.category_id}`,
            name: cat.name,
            parentId: cat.parent_id ? `cat-${cat.parent_id}` : 'root',
            expanded: false
          }));
          setFolders([{ id: "root", name: "전체", parentId: null, expanded: true }, ...categoryFolders]);
        }
        if (fileRes.ok) {
          const fileData = await fileRes.json();
          setFiles(fileData.files.map((ev: any) => ({
            id: ev.evidence_id.toString(),
            name: ev.file_name,
            type: ev.file_type || 'application/octet-stream',
            size: ev.file_size || 0,
            folder: ev.category_id ? `cat-${ev.category_id}` : 'root',
            uploadedAt: ev.created_at ? ev.created_at.split('T')[0] : '',
            modifiedAt: ev.created_at ? ev.created_at.split('T')[0] : '',
            linkedCases: ev.linked_case_ids ? ev.linked_case_ids.map((id: number) => id.toString()) : [],
            starred: ev.starred || false,
          })));
        }
        if (caseRes.ok) {
          const caseData = await caseRes.json();
          setCaseFolders(caseData.cases.map((c: any) => ({ id: c.id, title: c.title })));
        }
        if (docRes.ok) {
          const docData = await docRes.json();
          setAllDocuments(docData);
        }
      } catch (fallbackError) {
        console.error('개별 API도 실패:', fallbackError);
      }
    } finally {
      setIsLoadingFiles(false);
    }
  }, []);

  // 증거 파일만 새로고침 (업로드/삭제 후 사용)
  const fetchEvidences = useCallback(async () => {
    try {
      const response = await apiFetch('/api/v1/evidence/list');

      if (response.ok) {
        const data = await response.json();
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
    }
  }, []);

  // 초기 로드
  useEffect(() => {
    fetchInitData();
  }, [fetchInitData]);

  // 선택된 사건 폴더의 문서 목록 가져오기
  useEffect(() => {
    if (selectedCaseFolder === null) {
      setCaseDocuments([]);
      return;
    }

    const fetchCaseDocuments = async () => {
      setIsLoadingDocuments(true);
      try {
        const response = await apiFetch(`/api/v1/documents/case/${selectedCaseFolder}`);
        if (response.ok) {
          const data = await response.json();
          setCaseDocuments(data.map((d: any) => ({ ...d, case_id: selectedCaseFolder })));
        }
      } catch (error) {
        console.error('사건 문서 목록 조회 실패:', error);
      } finally {
        setIsLoadingDocuments(false);
      }
    };
    fetchCaseDocuments();
  }, [selectedCaseFolder]);

  // F2: 이름 변경, Delete: 폴더 삭제
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (pageMode !== 'evidence' || selectedFolder === 'root') return;
      if (renamingFolderId || inlineNewFolderParentId) return;
      if (e.key === 'F2') {
        e.preventDefault();
        startRenameFolder(selectedFolder);
      } else if (e.key === 'Delete') {
        e.preventDefault();
        deleteFolder(selectedFolder);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFolder, pageMode, renamingFolderId, inlineNewFolderParentId]);

  // 컨텍스트 메뉴 외부 클릭 닫기
  useEffect(() => {
    if (!folderContextMenu) return;
    const handleClick = () => setFolderContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [folderContextMenu]);

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
          const response = await apiFetch('/api/v1/evidence/upload', {
            method: 'POST',
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
        const response = await apiFetch('/api/v1/evidence/upload', {
          method: 'POST',
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
    if (!fileToDelete || isDeleting) return;

    setIsDeleting(true);

    try {
      const evidenceId = fileToDelete.id;

      // 백엔드 API 호출하여 파일 삭제
      const response = await apiFetch(`/api/v1/evidence/delete/${evidenceId}`, {
        method: 'DELETE'
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
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleStar = async (fileId: string) => {
    try {
      // 백엔드 API 호출하여 starred 토글
      const response = await apiFetch(`/api/v1/evidence/${fileId}/starred`, {
        method: 'PATCH'
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
    let result = selectedFolder !== "root"
      ? getFilesInFolder(selectedFolder)
      : files;

    if (filterMode === "starred") {
      result = result.filter((f) => f.starred);
    } else if (filterMode === "recent") {
      result = [...result].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 20);
    }

    if (searchQuery) {
      result = result.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return result;
  })();

  // 문서 필터링
  const filteredDocuments = (() => {
    let docs = selectedCaseFolder !== null
      ? caseDocuments
      : allDocuments;

    if (filterMode === "recent") {
      docs = [...docs].sort((a, b) =>
        (b.updated_at || "").localeCompare(a.updated_at || "")
      ).slice(0, 20);
    }

    if (searchQuery) {
      docs = docs.filter((d) =>
        d.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return docs;
  })();

  const openLinkModal = (file?: ManagedFile) => {
    if (file) {
      setSelectedFileForLink(file);
      setFilesToLink([file.id]);
    } else {
      setSelectedFileForLink(null);
      setFilesToLink(Array.from(selectedFiles));
    }
    setSelectedCaseForLink("");
    setCaseSearchQuery("");
    setShowLinkModal(true);
  };

  const linkFileToCase = async () => {
    if (filesToLink.length === 0 || !selectedCaseForLink) return;

    try {
      for (const evidenceId of filesToLink) {
        const response = await apiFetch(`/api/v1/evidence/${evidenceId}/link-case/${selectedCaseForLink}`, {
          method: 'POST'
        });
        if (!response.ok) throw new Error(`연결 실패: ${response.statusText}`);
      }

      await fetchEvidences();
      setShowLinkModal(false);
      setSelectedFileForLink(null);
      setFilesToLink([]);
      setSelectedCaseForLink("");
      setSelectedFiles(new Set());
    } catch (error) {
      console.error('사건 연결 실패:', error);
      alert(`사건 연결 실패: ${error}`);
    }
  };

  // 단일 파일 다운로드
  const downloadFile = async (fileId: string, fileName: string) => {
    try {
      // Signed URL 가져오기
      const response = await apiFetch(`/api/v1/evidence/${fileId}/url`);

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

  // 카테고리 목록 새로고침 (expanded 상태 보존)
  const refreshCategories = async () => {
    const response = await apiFetch('/api/v1/evidence/categories');
    if (response.ok) {
      const data = await response.json();
      const categoryFolders: FileFolder[] = data.categories.map((cat: any) => ({
        id: `cat-${cat.category_id}`,
        name: cat.name,
        parentId: cat.parent_id ? `cat-${cat.parent_id}` : 'root',
        expanded: false
      }));
      setFolders(prev => {
        const expandedIds = new Set(prev.filter(f => f.expanded).map(f => f.id));
        return [
          { id: "root", name: "전체", parentId: null, expanded: true },
          ...categoryFolders.map(f => ({ ...f, expanded: expandedIds.has(f.id) }))
        ];
      });
    }
  };

  // 중복 없는 폴더명 생성
  const getNextFolderName = (parentId: string) => {
    const baseName = "새 폴더";
    const siblings = folders.filter(f => f.parentId === parentId);
    const existingNames = new Set(siblings.map(f => f.name));
    if (!existingNames.has(baseName)) return baseName;
    let i = 1;
    while (existingNames.has(`${baseName}(${i})`)) i++;
    return `${baseName}(${i})`;
  };

  const addCategory = () => {
    const parentId = selectedFolder;
    setInlineNewFolderParentId(parentId);
    setInlineNewFolderName(getNextFolderName(parentId));
    if (parentId !== "root") {
      setFolders(prev => prev.map(f => f.id === parentId ? { ...f, expanded: true } : f));
    }
  };

  const cancelInlineFolder = () => {
    setInlineNewFolderParentId(null);
    setInlineNewFolderName("");
  };

  const handleCreateCategory = async () => {
    if (creatingFolderRef.current || !inlineNewFolderName.trim() || inlineNewFolderParentId === null) return;

    creatingFolderRef.current = true;
    const name = inlineNewFolderName.trim();
    const parentId = inlineNewFolderParentId;

    setInlineNewFolderParentId(null);
    setInlineNewFolderName("");

    try {
      const response = await apiFetch('/api/v1/evidence/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          parent_id: parentId === 'root' ? null : parseInt(parentId.replace('cat-', '')),
          order_index: 0
        })
      });
      if (!response.ok) throw new Error(`폴더 생성 실패: ${response.statusText}`);
      await refreshCategories();
    } catch (error) {
      console.error('폴더 생성 실패:', error);
      alert(`폴더 생성 실패: ${error}`);
    } finally {
      creatingFolderRef.current = false;
    }
  };

  // 폴더 이름 변경
  const startRenameFolder = (folderId: string) => {
    const folder = folders.find(f => f.id === folderId);
    if (!folder || folderId === 'root') return;
    setRenamingFolderId(folderId);
    setRenamingFolderName(folder.name);
    setFolderContextMenu(null);
  };

  const cancelRenameFolder = () => {
    setRenamingFolderId(null);
    setRenamingFolderName("");
  };

  const handleRenameFolder = async () => {
    if (renamingRef.current || !renamingFolderName.trim() || !renamingFolderId) return;

    const newName = renamingFolderName.trim();
    const folderId = renamingFolderId;
    const oldFolder = folders.find(f => f.id === folderId);

    if (oldFolder && oldFolder.name === newName) {
      cancelRenameFolder();
      return;
    }

    renamingRef.current = true;
    setRenamingFolderId(null);
    setRenamingFolderName("");

    const categoryId = parseInt(folderId.replace('cat-', ''));

    try {
      const response = await apiFetch(`/api/v1/evidence/categories/${categoryId}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      if (!response.ok) throw new Error('이름 변경 실패');
      setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: newName } : f));
    } catch (error) {
      console.error('폴더 이름 변경 실패:', error);
      alert(`폴더 이름 변경 실패: ${error}`);
    } finally {
      renamingRef.current = false;
    }
  };

  // 폴더 삭제 (하위 폴더 포함, 파일은 미분류로 이동)
  const deleteFolder = async (folderId: string) => {
    if (folderId === 'root') return;
    setFolderContextMenu(null);
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;

    const hasChild = folders.some(f => f.parentId === folderId);
    const msg = hasChild
      ? `"${folder.name}" 폴더와 하위 폴더를 모두 삭제하시겠습니까?\n(파일은 삭제되지 않고 미분류로 이동됩니다)`
      : `"${folder.name}" 폴더를 삭제하시겠습니까?\n(파일은 삭제되지 않고 미분류로 이동됩니다)`;
    if (!confirm(msg)) return;

    const categoryId = parseInt(folderId.replace('cat-', ''));
    try {
      const response = await apiFetch(`/api/v1/evidence/categories/delete/${categoryId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('삭제 실패');
      await refreshCategories();
      await fetchEvidences();
      if (selectedFolder === folderId) setSelectedFolder('root');
    } catch (error) {
      console.error('폴더 삭제 실패:', error);
      alert(`폴더 삭제 실패: ${error}`);
    }
  };

  // 폴더 드래그 앤 드롭 이동
  const isDescendantOf = (parentId: string, targetId: string): boolean => {
    const children = folders.filter(f => f.parentId === parentId);
    return children.some(c => c.id === targetId || isDescendantOf(c.id, targetId));
  };

  const handleMoveFolder = async (folderId: string, newParentId: string) => {
    if (folderId === newParentId || folderId === 'root') return;
    if (newParentId !== 'root' && isDescendantOf(folderId, newParentId)) return;

    const currentFolder = folders.find(f => f.id === folderId);
    if (currentFolder?.parentId === newParentId) return;

    const categoryId = parseInt(folderId.replace('cat-', ''));
    const parentCategoryId = newParentId === 'root' ? null : parseInt(newParentId.replace('cat-', ''));

    try {
      const response = await apiFetch(`/api/v1/evidence/categories/${categoryId}/move`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_id: parentCategoryId })
      });
      if (!response.ok) throw new Error('이동 실패');
      await refreshCategories();
    } catch (error) {
      console.error('폴더 이동 실패:', error);
      alert(`폴더 이동 실패: ${error}`);
    }
  };

  const getDocumentTypeName = (type: string) => {
    const typeMap: Record<string, string> = {
      criminal_complaint: "고소장",
      demand_letter: "내용증명",
      civil_complaint: "소장",
    };
    return typeMap[type] || type;
  };

  const handleDocumentClick = (doc: DocumentItem) => {
    navigate(`/cases/${doc.case_id}?tab=documents`);
  };


  const renderFolderTree = (parentId: string | null, depth: number = 0) => {
    const childFolders = getChildFolders(parentId);
    const showInlineInput = inlineNewFolderParentId === parentId;

    if (childFolders.length === 0 && !showInlineInput) return null;

    return (
      <div className={depth > 0 ? "ml-4" : ""}>
        {childFolders.map((folder) => {
          const isExpanded = folder.expanded;
          const hasChildFolders = hasChildren(folder.id);
          const isSelected = selectedFolder === folder.id;
          const fileCount = files.filter((f) => f.folder === folder.id).length;
          const needsSubtree = (isExpanded && hasChildFolders) || inlineNewFolderParentId === folder.id;
          const isRenaming = renamingFolderId === folder.id;
          const isDragOver = dragOverFolderId === folder.id;

          return (
            <div key={folder.id}>
              <div
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  setDraggedFolderId(folder.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (draggedFolderId && draggedFolderId !== folder.id) {
                    setDragOverFolderId(folder.id);
                  }
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  if (dragOverFolderId === folder.id) setDragOverFolderId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverFolderId(null);
                  if (draggedFolderId && draggedFolderId !== folder.id) {
                    handleMoveFolder(draggedFolderId, folder.id);
                  }
                  setDraggedFolderId(null);
                }}
                onDragEnd={() => { setDraggedFolderId(null); setDragOverFolderId(null); }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setFolderContextMenu({ folderId: folder.id, x: e.clientX, y: e.clientY });
                }}
                onClick={() => setSelectedFolder(folder.id)}
                onDoubleClick={() => startRenameFolder(folder.id)}
                className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors group cursor-default ${
                  isDragOver
                    ? "bg-primary/15 ring-1 ring-primary/40"
                    : isSelected
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
                {isRenaming ? (
                  <input
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    value={renamingFolderName}
                    onChange={(e) => setRenamingFolderName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleRenameFolder();
                      } else if (e.key === 'Escape') {
                        cancelRenameFolder();
                      }
                    }}
                    onBlur={() => {
                      if (renamingRef.current) return;
                      if (renamingFolderName.trim()) {
                        handleRenameFolder();
                      } else {
                        cancelRenameFolder();
                      }
                    }}
                    className="flex-1 text-sm bg-transparent border border-primary/30 rounded px-1.5 py-0.5 outline-none focus:border-primary min-w-0"
                  />
                ) : (
                  <>
                    <span className="truncate flex-1 text-left">{folder.name}</span>
                    {fileCount > 0 && (
                      <span className="text-xs text-muted-foreground/70">{fileCount}</span>
                    )}
                  </>
                )}
              </div>
              {needsSubtree && renderFolderTree(folder.id, depth + 1)}
            </div>
          );
        })}
        {showInlineInput && (
          <div className="flex items-center gap-1.5 px-2 py-1">
            <span className="w-4" />
            <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              autoFocus
              onFocus={(e) => e.target.select()}
              value={inlineNewFolderName}
              onChange={(e) => setInlineNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreateCategory();
                } else if (e.key === 'Escape') {
                  cancelInlineFolder();
                }
              }}
              onBlur={() => {
                if (creatingFolderRef.current) return;
                if (inlineNewFolderName.trim()) {
                  handleCreateCategory();
                } else {
                  cancelInlineFolder();
                }
              }}
              className="flex-1 text-sm bg-transparent border border-primary/30 rounded px-1.5 py-0.5 outline-none focus:border-primary min-w-0"
            />
          </div>
        )}
      </div>
    );
  };

  const currentFolderPath = getFolderPath(selectedFolder);

  if (isLoadingFiles) {
    return (
      <div className="flex items-center justify-center" style={{ height: 'calc(100vh - 120px)' }}>
        <video src="/assets/loading-card.mp4" autoPlay loop muted playsInline className="h-28 w-28" style={{ mixBlendMode: 'multiply', opacity: 0.3 }} />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-7rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border/60">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold">파일 관리</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={pageMode === "evidence" ? "파일 검색..." : "문서 검색..."}
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
          {/* Upload Button (증거 파일 모드에서만) */}
          {pageMode === "evidence" && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Sub toolbar: Breadcrumb + Filter */}
      <div className="flex items-center justify-between py-2">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm">
          {pageMode === "evidence" && selectedFolder !== "root" ? (
            currentFolderPath.slice(1).map((folder, idx) => (
              <React.Fragment key={folder.id}>
                {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/40" />}
                <button
                  type="button"
                  onClick={() => setSelectedFolder(folder.id)}
                  className={`px-1.5 py-0.5 rounded text-xs hover:bg-secondary transition-colors ${idx === currentFolderPath.length - 2
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {folder.name}
                </button>
              </React.Fragment>
            ))
          ) : pageMode === "documents" && selectedCaseFolder !== null ? (
            <span className="px-1.5 py-0.5 text-xs text-foreground font-medium">
              {caseFolders.find(c => c.id === selectedCaseFolder)?.title}
            </span>
          ) : null}
        </nav>

        {/* Filter Pills */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFilterMode("all")}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              filterMode === "all"
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setFilterMode("recent")}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              filterMode === "recent"
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Clock className="h-3 w-3" />
            최근
          </button>
          {pageMode === "evidence" && (
            <button
              type="button"
              onClick={() => setFilterMode("starred")}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                filterMode === "starred"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Star className="h-3 w-3" />
              중요
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-0 min-h-0">
        {/* Sidebar */}
        <div className="w-48 shrink-0 pr-3 border-r border-border/40 flex flex-col">
          {/* Sub-page Tabs */}
          <div className="flex gap-1 mb-3">
            <button
              type="button"
              className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-md font-medium transition-colors ${
                pageMode === "evidence"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              onClick={() => { setPageMode("evidence"); setFilterMode("all"); setSearchQuery(""); }}
            >
              <HardDrive className="h-3.5 w-3.5" />
              증거
            </button>
            <button
              type="button"
              className={`flex-1 flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-md font-medium transition-colors ${
                pageMode === "documents"
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              onClick={() => { setPageMode("documents"); setFilterMode("all"); setSearchQuery(""); }}
            >
              <FileText className="h-3.5 w-3.5" />
              문서
            </button>
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto space-y-0.5">
            {pageMode === "evidence" ? (
              <>
                <div
                  onClick={() => setSelectedFolder("root")}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedFolderId) setDragOverFolderId("root");
                  }}
                  onDragLeave={() => { if (dragOverFolderId === "root") setDragOverFolderId(null); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverFolderId(null);
                    if (draggedFolderId) {
                      handleMoveFolder(draggedFolderId, "root");
                      setDraggedFolderId(null);
                    }
                  }}
                  className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors cursor-default ${
                    dragOverFolderId === "root"
                      ? "bg-primary/15 ring-1 ring-primary/40"
                      : selectedFolder === "root"
                        ? "bg-secondary text-foreground font-medium"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  }`}
                >
                  <HardDrive className="h-3.5 w-3.5 shrink-0" />
                  <span>전체</span>
                  <span className="ml-auto text-[10px] text-muted-foreground/50 tabular-nums">{files.length}</span>
                </div>
                {renderFolderTree("root")}
                <button
                  type="button"
                  onClick={addCategory}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary/30 transition-colors mt-1"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span>폴더 추가</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setSelectedCaseFolder(null)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
                    selectedCaseFolder === null
                      ? "bg-secondary text-foreground font-medium"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span>전체</span>
                  <span className="ml-auto text-[10px] text-muted-foreground/50 tabular-nums">{allDocuments.length}</span>
                </button>
                {caseFolders.map((caseItem) => {
                  const isSelected = selectedCaseFolder === caseItem.id;
                  const docCount = allDocuments.filter(d => d.case_id === caseItem.id).length;
                  return (
                    <button
                      key={caseItem.id}
                      type="button"
                      onClick={() => setSelectedCaseFolder(caseItem.id)}
                      className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
                        isSelected
                          ? "bg-secondary text-foreground font-medium"
                          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                      }`}
                    >
                      <Briefcase className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate flex-1 text-left">{caseItem.title}</span>
                      {docCount > 0 && (
                        <span className="text-[10px] text-muted-foreground/50 tabular-nums">{docCount}</span>
                      )}
                    </button>
                  );
                })}
                {caseFolders.length === 0 && (
                  <p className="px-2 py-3 text-[11px] text-muted-foreground/40 text-center">등록된 사건이 없습니다</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* File Area */}
        <div className="flex-1 pl-4 flex flex-col min-h-0">
          {/* Bulk Actions Bar */}
          {selectedFiles.size > 0 && pageMode === "evidence" && (
            <div className="flex items-center gap-2 pb-3 border-b border-border/60 mb-3">
              <span className="text-sm text-muted-foreground">
                {selectedFiles.size}개 선택됨
              </span>
              <Button variant="outline" size="sm" onClick={() => openLinkModal()}>
                <Link2 className="h-3.5 w-3.5 mr-1.5" />
                사건에 연결
              </Button>
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

          {/* Documents View */}
          {pageMode === "documents" ? (
            <div className="flex-1 overflow-auto">
              {isLoadingDocuments ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">
                      {searchQuery ? "검색 결과가 없습니다" : selectedCaseFolder !== null ? "이 사건에 작성된 문서가 없습니다" : "작성된 문서가 없습니다"}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      사건 상세 페이지에서 문서를 작성해보세요
                    </p>
                  </div>
                </div>
              ) : viewMode === "list" ? (
                <div className="border border-border/60 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-secondary/30 border-b border-border/60">
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">제목</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-28">문서 유형</th>
                        {selectedCaseFolder === null && (
                          <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-48">사건명</th>
                        )}
                        <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-32">수정일</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDocuments.map((doc) => (
                        <tr
                          key={doc.id}
                          onClick={() => handleDocumentClick(doc)}
                          className="border-b border-border/40 hover:bg-secondary/20 transition-colors cursor-pointer"
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded bg-secondary/50 flex items-center justify-center shrink-0">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <span className="font-medium truncate">{doc.title}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="secondary" className="text-xs">
                              {getDocumentTypeName(doc.document_type)}
                            </Badge>
                          </td>
                          {selectedCaseFolder === null && (
                            <td className="px-3 py-2 text-muted-foreground text-xs">
                              {caseFolders.find(c => c.id === doc.case_id)?.title || "-"}
                            </td>
                          )}
                          <td className="px-3 py-2 text-muted-foreground">
                            {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString('ko-KR') : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-3">
                  {filteredDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => handleDocumentClick(doc)}
                      className="group relative p-3 rounded-lg border border-border/60 hover:border-border hover:bg-secondary/20 transition-all cursor-pointer"
                    >
                      <div className="w-12 h-12 mx-auto rounded-lg bg-secondary/50 flex items-center justify-center mb-2 mt-2">
                        <FileText className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium text-center truncate px-1">{doc.title}</p>
                      <p className="text-xs text-muted-foreground text-center mt-0.5">
                        {getDocumentTypeName(doc.document_type)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
          /* Drop Zone (when dragging) */
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
                    "{folders.find((f) => f.id === selectedFolder)?.name || "전체"}" 폴더에 업로드됩니다
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
                            <div
                              className="flex items-center gap-2.5 cursor-pointer"
                              onClick={() => navigate(`/evidence/${file.id}`)}
                            >
                              <div className="w-8 h-8 rounded bg-secondary/50 flex items-center justify-center shrink-0">
                                <FileIcon className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <span className="font-medium truncate hover:text-primary transition-colors">{file.name}</span>
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
                      onClick={() => navigate(`/evidence/${file.id}`)}
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
          )}
        </div>
      </div>

      {/* Link to Case Modal */}
      {showLinkModal && filesToLink.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base">사건에 연결</CardTitle>
              <CardDescription className="text-sm">
                {selectedFileForLink
                  ? `"${selectedFileForLink.name}" 파일을 연결할 사건을 선택하세요`
                  : `${filesToLink.length}개 파일을 연결할 사건을 선택하세요`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 사건 검색 */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="사건명 검색..."
                  value={caseSearchQuery}
                  onChange={(e) => setCaseSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-sm"
                  autoFocus
                />
              </div>
              {/* 사건 목록 (스크롤) */}
              <div className="max-h-56 overflow-y-auto border border-border/60 rounded-lg">
                {caseFolders
                  .filter((c) => !caseSearchQuery || c.title.toLowerCase().includes(caseSearchQuery.toLowerCase()))
                  .map((caseItem) => {
                    const isSelected = selectedCaseForLink === String(caseItem.id);
                    return (
                      <button
                        key={caseItem.id}
                        type="button"
                        onClick={() => setSelectedCaseForLink(String(caseItem.id))}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors border-b border-border/30 last:border-b-0 ${
                          isSelected
                            ? "bg-primary/10 text-primary font-medium"
                            : "hover:bg-secondary/50"
                        }`}
                      >
                        <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{caseItem.title}</span>
                      </button>
                    );
                  })}
                {caseFolders.filter((c) => !caseSearchQuery || c.title.toLowerCase().includes(caseSearchQuery.toLowerCase())).length === 0 && (
                  <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                    {caseSearchQuery ? "검색 결과가 없습니다" : "등록된 사건이 없습니다"}
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowLinkModal(false);
                    setSelectedFileForLink(null);
                    setFilesToLink([]);
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
                  disabled={isDeleting}
                >
                  취소
                </Button>
                <Button
                  variant="destructive"
                  onClick={confirmDeleteFile}
                  disabled={isDeleting}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      삭제 중...
                    </>
                  ) : (
                    "삭제"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Folder Context Menu */}
      {folderContextMenu && (
        <div
          className="fixed z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-[120px]"
          style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary transition-colors"
            onClick={() => startRenameFolder(folderContextMenu.folderId)}
          >
            이름 변경
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary transition-colors text-destructive"
            onClick={() => deleteFolder(folderContextMenu.folderId)}
          >
            삭제
          </button>
        </div>
      )}
    </div>
  );
}
