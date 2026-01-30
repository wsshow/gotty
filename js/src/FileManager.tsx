import { useState, useEffect, useRef } from 'preact/hooks';
import { marked } from 'marked';
import hljs from 'highlight.js';
import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';
import * as Papa from 'papaparse';
import * as pdfjsLib from 'pdfjs-dist';

interface FileInfo {
    name: string;
    size?: number;
    time: number;
    isDir: boolean;
}

interface FileManagerProps {
    onClose: () => void;
}

interface UploadProgress {
    [key: string]: {
        progress: number;
        total: number;
        filename: string;
    };
}

interface BatchUploadStats {
    totalFiles: number;
    completedFiles: number;
    totalBytes: number;
    uploadedBytes: number;
    startTime: number;
    currentFile: string;
    speed: number; // bytes per second
    remainingTime: number; // seconds
}

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB per chunk
const LARGE_FILE_SIZE = 10 * 1024 * 1024; // Files larger than 10MB use chunked upload

export const FileManager = ({ onClose }: FileManagerProps) => {
    // Load initial state from sessionStorage
    const loadSavedState = () => {
        try {
            const saved = sessionStorage.getItem('fileManagerState');
            if (saved) {
                const state = JSON.parse(saved);
                return {
                    currentPath: state.currentPath || '.',
                    pathHistory: state.pathHistory || ['.'],
                    selectedFiles: new Set<string>(state.selectedFiles || [])
                };
            }
        } catch (err) {
            console.error('Failed to load saved state:', err);
        }
        return {
            currentPath: '.',
            pathHistory: ['.'],
            selectedFiles: new Set<string>()
        };
    };

    const initialState = loadSavedState();

    const [files, setFiles] = useState<FileInfo[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(initialState.selectedFiles);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<UploadProgress>({});
    const [batchUploadStats, setBatchUploadStats] = useState<BatchUploadStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [currentPath, setCurrentPath] = useState<string>(initialState.currentPath);
    const [pathHistory, setPathHistory] = useState<string[]>(initialState.pathHistory);
    const [confirmDelete, setConfirmDelete] = useState<{ file: FileInfo; show: boolean } | null>(null);
    const [confirmBatchDelete, setConfirmBatchDelete] = useState<{ files: string[]; show: boolean } | null>(null);
    const [confirmDownload, setConfirmDownload] = useState<{ file: FileInfo; show: boolean } | null>(null);
    const [previewFile, setPreviewFile] = useState<{ file: FileInfo; content: string | null; type: string } | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<{ filename: string; progress: number } | null>(null);
    const [batchDownloadProgress, setBatchDownloadProgress] = useState<{ 
        status: 'preparing' | 'downloading' | 'complete';
        fileCount: number;
        downloaded: number;
        totalBytes: number;
        speed: number;
        remainingTime: number;
    } | null>(null);
    const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);
    const [pdfState, setPdfState] = useState<{
        totalPages: number;
        pdfDoc: any;
        thumbnails: Array<string | null>;
        renderedPages: number;
        viewMode: 'grid' | 'single';
        currentPage: number | null;
        fullPageUrl: string | null;
    } | null>(null);
    const [pdfThumbLoading, setPdfThumbLoading] = useState(false);
    const [pdfPageLoading, setPdfPageLoading] = useState(false);
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const previewContainerRef = useRef<HTMLDivElement>(null);
    const pdfGridRef = useRef<HTMLDivElement>(null);

    // Configure PDF.js worker
    useEffect(() => {
        // Use worker from static directory
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/pdf.worker.min.js';
    }, []);

    const getAuthHeaders = (): Record<string, string> => {
        const auth = sessionStorage.getItem('gotty_auth');
        if (auth) {
            return {
                'Authorization': `Basic ${auth}`
            };
        }
        return {};
    };

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    const formatSpeed = (bytesPerSecond: number): string => {
        return formatBytes(bytesPerSecond) + '/s';
    };

    const formatTime = (seconds: number): string => {
        if (!isFinite(seconds) || seconds < 0) return '--:--';
        if (seconds < 60) return `${Math.round(seconds)}秒`;
        const minutes = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        if (minutes < 60) return `${minutes}分${secs}秒`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}小时${mins}分`;
    };

    useEffect(() => {
        loadFiles(currentPath);
    }, [currentPath]);

    // Save state to sessionStorage whenever it changes
    useEffect(() => {
        try {
            const stateToSave = {
                currentPath,
                pathHistory,
                selectedFiles: Array.from(selectedFiles)
            };
            sessionStorage.setItem('fileManagerState', JSON.stringify(stateToSave));
        } catch (err) {
            console.error('Failed to save state:', err);
        }
    }, [currentPath, pathHistory, selectedFiles]);

    const loadFiles = async (path: string = '.') => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`api/files?path=${encodeURIComponent(path)}`, {
                headers: getAuthHeaders()
            });
            if (!response.ok) {
                throw new Error('Failed to load files');
            }
            const data = await response.json();
            const loadedFiles = data.files || [];
            setFiles(loadedFiles);
            setCurrentPath(data.currentPath || '.');

            // Clean up invalid selections (files that no longer exist)
            if (selectedFiles.size > 0) {
                const validFileNames = new Set(loadedFiles.map((f: FileInfo) => f.name));
                const validSelections = Array.from(selectedFiles).filter(name => validFileNames.has(name));
                if (validSelections.length !== selectedFiles.size) {
                    setSelectedFiles(new Set(validSelections));
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load files');
        } finally {
            setLoading(false);
        }
    };

    const navigateToFolder = (folderName: string) => {
        const newPath = currentPath === '.' ? folderName : `${currentPath}/${folderName}`;
        setPathHistory([...pathHistory, newPath]);
        setCurrentPath(newPath);
        setSelectedFiles(new Set());
    };

    const navigateBack = () => {
        if (pathHistory.length > 1) {
            const newHistory = pathHistory.slice(0, -1);
            setPathHistory(newHistory);
            setCurrentPath(newHistory[newHistory.length - 1]);
            setSelectedFiles(new Set());
        }
    };

    const getFilePath = (fileName: string) => {
        return currentPath === '.' ? fileName : `${currentPath}/${fileName}`;
    };

    const toggleFileSelection = (fileName: string) => {
        const newSelected = new Set(selectedFiles);
        if (newSelected.has(fileName)) {
            newSelected.delete(fileName);
        } else {
            newSelected.add(fileName);
        }
        setSelectedFiles(newSelected);
    };

    const uploadChunkedFile = async (file: File, relativePath: string) => {
        const fileId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        
        setUploadProgress(prev => ({
            ...prev,
            [fileId]: { progress: 0, total: file.size, filename: file.name }
        }));

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const start = chunkIndex * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);

            const formData = new FormData();
            formData.append('chunk', chunk);
            formData.append('chunkIndex', chunkIndex.toString());
            formData.append('totalChunks', totalChunks.toString());
            formData.append('fileId', fileId);
            formData.append('filename', relativePath);
            formData.append('path', currentPath);

            const response = await fetch('api/upload-chunk', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Chunk ${chunkIndex} upload failed`);
            }

            setUploadProgress(prev => ({
                ...prev,
                [fileId]: { ...prev[fileId], progress: end }
            }));
        }

        setUploadProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[fileId];
            return newProgress;
        });
    };

    const handleBatchUpload = async (fileList: FileList) => {
        setUploading(true);
        setError(null);

        try {
            // Group files by size
            const largeFiles: { file: File; path: string }[] = [];
            const normalFiles: { file: File; path: string }[] = [];
            let totalBytes = 0;

            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];
                const relativePath = (file as any).webkitRelativePath || file.name;
                totalBytes += file.size;
                
                console.log(`Processing file: ${file.name}, webkitRelativePath: ${(file as any).webkitRelativePath}, using: ${relativePath}`);
                
                if (file.size > LARGE_FILE_SIZE) {
                    largeFiles.push({ file, path: relativePath });
                } else {
                    normalFiles.push({ file, path: relativePath });
                }
            }

            // Initialize batch upload stats
            const startTime = Date.now();
            setBatchUploadStats({
                totalFiles: fileList.length,
                completedFiles: 0,
                totalBytes,
                uploadedBytes: 0,
                startTime,
                currentFile: '',
                speed: 0,
                remainingTime: 0
            });

            let completedFiles = 0;
            let uploadedBytes = 0;

            // Upload normal files in batch (with progress for each)
            if (normalFiles.length > 0) {
                const formData = new FormData();
                formData.append('path', currentPath);
                
                // Show upload progress
                const uploadId = `batch_${Date.now()}`;
                let totalSize = 0;
                
                // Build arrays for files and their paths
                const filePaths: string[] = [];
                
                for (const { file, path } of normalFiles) {
                    totalSize += file.size;
                    formData.append('files', file);
                    filePaths.push(path);
                }
                
                // Send paths as a JSON string
                formData.append('filePaths', JSON.stringify(filePaths));
                
                // Update stats with current batch info
                setBatchUploadStats(prev => prev ? {
                    ...prev,
                    currentFile: `批量上传 ${normalFiles.length} 个文件...`
                } : null);

                setUploadProgress(prev => ({
                    ...prev,
                    [uploadId]: { progress: 0, total: totalSize, filename: `批量上传 (${normalFiles.length} 个文件)` }
                }));

                // Use XMLHttpRequest to track upload progress
                await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    const batchStartTime = Date.now();
                    
                    xhr.upload.addEventListener('progress', (e) => {
                        if (e.lengthComputable) {
                            const elapsed = (Date.now() - batchStartTime) / 1000;
                            const speed = elapsed > 0 ? e.loaded / elapsed : 0;
                            const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0;

                            setBatchUploadStats(prev => prev ? {
                                ...prev,
                                uploadedBytes: uploadedBytes + e.loaded,
                                speed,
                                remainingTime: remaining
                            } : null);

                            setUploadProgress(prev => ({
                                ...prev,
                                [uploadId]: { progress: e.loaded, total: e.total, filename: `批量上传 (${normalFiles.length} 个文件)` }
                            }));
                        }
                    });
                    
                    xhr.addEventListener('load', () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            resolve(xhr.response);
                        } else {
                            reject(new Error('Batch upload failed'));
                        }
                    });
                    
                    xhr.addEventListener('error', () => reject(new Error('Batch upload failed')));
                    
                    xhr.open('POST', 'api/upload');
                    
                    // Add auth headers
                    const auth = sessionStorage.getItem('gotty_auth');
                    if (auth) {
                        xhr.setRequestHeader('Authorization', `Basic ${auth}`);
                    }
                    
                    xhr.send(formData);
                });
                
                completedFiles += normalFiles.length;
                uploadedBytes += totalSize;

                setUploadProgress(prev => {
                    const newProgress = { ...prev };
                    delete newProgress[uploadId];
                    return newProgress;
                });
            }

            // Upload large files with chunking (with individual progress)
            for (let i = 0; i < largeFiles.length; i++) {
                const { file, path } = largeFiles[i];
                
                setBatchUploadStats(prev => prev ? {
                    ...prev,
                    completedFiles,
                    uploadedBytes,
                    currentFile: path
                } : null);

                await uploadChunkedFile(file, path);
                
                completedFiles++;
                uploadedBytes += file.size;

                // Update stats after each file
                const elapsed = (Date.now() - startTime) / 1000;
                const speed = elapsed > 0 ? uploadedBytes / elapsed : 0;
                const remaining = speed > 0 ? (totalBytes - uploadedBytes) / speed : 0;

                setBatchUploadStats(prev => prev ? {
                    ...prev,
                    completedFiles,
                    uploadedBytes,
                    speed,
                    remainingTime: remaining
                } : null);
            }

            await loadFiles(currentPath);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setUploading(false);
            setBatchUploadStats(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            if (folderInputRef.current) folderInputRef.current.value = '';
        }
    };

    const handleFileUpload = async (event: Event) => {
        const target = event.target as HTMLInputElement;
        if (!target.files || target.files.length === 0) return;
        await handleBatchUpload(target.files);
    };

    const handleFolderUpload = async (event: Event) => {
        const target = event.target as HTMLInputElement;
        if (!target.files || target.files.length === 0) return;
        await handleBatchUpload(target.files);
    };

    const downloadWithProgress = async (url: string, filename: string) => {
        setDownloadProgress({ filename, progress: 0 });

        try {
            const response = await fetch(url, {
                headers: getAuthHeaders()
            });

            if (!response.ok) {
                throw new Error('Download failed');
            }

            const contentLength = response.headers.get('Content-Length');
            const total = contentLength ? parseInt(contentLength, 10) : 0;

            const reader = response.body?.getReader();
            if (!reader) throw new Error('Cannot read response');

            const chunks: Uint8Array[] = [];
            let received = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                chunks.push(value);
                received += value.length;

                if (total > 0) {
                    setDownloadProgress({ filename, progress: (received / total) * 100 });
                }
            }

            const blob = new Blob(chunks as BlobPart[]);
            const objectUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(objectUrl);
            document.body.removeChild(a);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Download failed');
        } finally {
            setDownloadProgress(null);
        }
    };

    const handleDownload = async (file: FileInfo) => {
        if (file.isDir) {
            navigateToFolder(file.name);
        } else {
            const filePath = getFilePath(file.name);
            await downloadWithProgress(
                `api/download?file=${encodeURIComponent(filePath)}`,
                file.name
            );
        }
    };

    const handleBatchDownload = async () => {
        if (selectedFiles.size === 0) return;

        setError(null);
        const filePaths = Array.from(selectedFiles).map(name => getFilePath(name));

        // Show preparing status
        setBatchDownloadProgress({
            status: 'preparing',
            fileCount: filePaths.length,
            downloaded: 0,
            totalBytes: 0,
            speed: 0,
            remainingTime: 0
        });

        try {
            const startTime = Date.now();
            
            // Use XMLHttpRequest for progress tracking
            await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                
                xhr.open('POST', 'api/batch-download');
                
                // Add auth headers
                const auth = sessionStorage.getItem('gotty_auth');
                if (auth) {
                    xhr.setRequestHeader('Authorization', `Basic ${auth}`);
                }
                xhr.setRequestHeader('Content-Type', 'application/json');
                
                xhr.responseType = 'blob';
                
                // Track download progress
                xhr.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        const elapsed = (Date.now() - startTime) / 1000;
                        const speed = elapsed > 0 ? e.loaded / elapsed : 0;
                        const remaining = speed > 0 ? (e.total - e.loaded) / speed : 0;

                        setBatchDownloadProgress({
                            status: 'downloading',
                            fileCount: filePaths.length,
                            downloaded: e.loaded,
                            totalBytes: e.total,
                            speed,
                            remainingTime: remaining
                        });
                    }
                });
                
                xhr.addEventListener('load', () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        const blob = xhr.response;
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'files.zip';
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        
                        // Show complete status briefly
                        setBatchDownloadProgress({
                            status: 'complete',
                            fileCount: filePaths.length,
                            downloaded: 0,
                            totalBytes: 0,
                            speed: 0,
                            remainingTime: 0
                        });
                        
                        setTimeout(() => {
                            setBatchDownloadProgress(null);
                        }, 2000);
                        
                        resolve();
                    } else {
                        reject(new Error('Batch download failed'));
                    }
                });
                
                xhr.addEventListener('error', () => {
                    reject(new Error('Batch download failed'));
                });
                
                xhr.send(JSON.stringify({ files: filePaths }));
            });

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Batch download failed');
            setBatchDownloadProgress(null);
        }
    };

    const handlePreview = async (file: FileInfo) => {
        if (file.isDir) {
            navigateToFolder(file.name);
            return;
        }

        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const imageMimeTypes = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'];
        const videoMimeTypes = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
        const codeMimeTypes = ['js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sass', 'less', 'json', 'xml', 'yaml', 'yml', 'go', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'hpp', 'rs', 'php', 'sh', 'bash', 'sql', 'r', 'swift', 'kt', 'dart'];
        const textMimeTypes = ['txt', 'log', 'conf', 'config', 'ini', 'env'];
        const markdownTypes = ['md', 'markdown'];
        const htmlTypes = ['html', 'htm'];
        const spreadsheetTypes = ['xlsx', 'xls', 'csv'];
        const docTypes = ['docx'];
        const pdfTypes = ['pdf'];

        // Check if file type is supported for preview
        const canPreview = imageMimeTypes.includes(ext) || videoMimeTypes.includes(ext) || codeMimeTypes.includes(ext) || textMimeTypes.includes(ext) || markdownTypes.includes(ext) || htmlTypes.includes(ext) || spreadsheetTypes.includes(ext) || docTypes.includes(ext) || pdfTypes.includes(ext);
        
        if (!canPreview) {
            // Show custom dialog for unsupported file types
            setConfirmDownload({ file, show: true });
            return;
        }

        setError(null);
        setPreviewLoading(true);
        const filePath = getFilePath(file.name);

        try {
            const response = await fetch(`api/download?file=${encodeURIComponent(filePath)}&preview=true`, {
                headers: getAuthHeaders()
            });

            if (!response.ok) {
                throw new Error('Preview failed');
            }

            if (imageMimeTypes.includes(ext)) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                setPreviewFile({ file, content: url, type: 'image' });
            } else if (videoMimeTypes.includes(ext)) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                setPreviewFile({ file, content: url, type: 'video' });
            } else if (markdownTypes.includes(ext)) {
                const text = await response.text();
                setPreviewFile({ file, content: text, type: 'markdown' });
            } else if (htmlTypes.includes(ext)) {
                const text = await response.text();
                setPreviewFile({ file, content: text, type: 'html' });
            } else if (codeMimeTypes.includes(ext) || textMimeTypes.includes(ext)) {
                const text = await response.text();
                setPreviewFile({ file, content: text, type: 'code' });
            } else if (ext === 'csv') {
                const text = await response.text();
                setPreviewFile({ file, content: text, type: 'csv' });
            } else if (ext === 'xlsx' || ext === 'xls') {
                const arrayBuffer = await response.arrayBuffer();
                const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const html = XLSX.utils.sheet_to_html(firstSheet, { header: '', footer: '' });
                setPreviewFile({ file, content: html, type: 'xlsx' });
            } else if (ext === 'docx') {
                const arrayBuffer = await response.arrayBuffer();
                const result = await mammoth.convertToHtml({ arrayBuffer });
                setPreviewFile({ file, content: result.value, type: 'docx' });
            } else if (ext === 'pdf') {
                const arrayBuffer = await response.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const pdfDoc = await loadingTask.promise;
                // Create blob from arrayBuffer for cleanup
                const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
                const url = window.URL.createObjectURL(blob);
                setPreviewFile({ file, content: url, type: 'pdf' });
                // Render thumbnails with lazy loading
                await initPdfThumbnails(pdfDoc);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Preview failed');
        } finally {
            setPreviewLoading(false);
        }
    };

    const closePreview = () => {
        if (previewFile?.type === 'image' && previewFile.content) {
            window.URL.revokeObjectURL(previewFile.content);
        }
        if (previewFile?.type === 'video' && previewFile.content) {
            window.URL.revokeObjectURL(previewFile.content);
        }
        if (previewFile?.type === 'pdf' && previewFile.content) {
            window.URL.revokeObjectURL(previewFile.content);
        }
        // Exit fullscreen if active
        if (document.fullscreenElement) {
            document.exitFullscreen();
        }
        setPreviewFile(null);
        setIsPreviewFullscreen(false);
        setCopySuccess(false);
        setPdfState(null);
    };

    const renderPdfThumbnailBatch = async (pdfDoc: any, startPage: number, batchSize = 1) => {
        try {
            setPdfThumbLoading(true);
            const totalPages = pdfDoc.numPages;
            const endPage = Math.min(startPage + batchSize - 1, totalPages);
            const batchThumbnails: Array<{ page: number; url: string }> = [];

            for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
                const page = await pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: 0.4 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');

                if (!context) continue;

                canvas.height = viewport.height;
                canvas.width = viewport.width;

                const renderContext = {
                    canvasContext: context,
                    viewport: viewport
                };

                await page.render(renderContext).promise;
                const thumbnailUrl = canvas.toDataURL('image/png');
                batchThumbnails.push({ page: pageNum, url: thumbnailUrl });
            }

            setPdfState(prev => {
                if (!prev) return prev;
                const updated = [...prev.thumbnails];
                batchThumbnails.forEach(item => {
                    updated[item.page - 1] = item.url;
                });
                return {
                    ...prev,
                    thumbnails: updated,
                    renderedPages: Math.max(prev.renderedPages, endPage)
                };
            });
        } catch (err) {
            console.error('PDF thumbnail render error:', err);
            setError('PDF缩略图生成失败');
        } finally {
            setPdfThumbLoading(false);
        }
    };

    const getPdfGridMetrics = () => {
        const grid = pdfGridRef.current;
        if (!grid) {
            return { batchSize: 12, rowHeight: 300 };
        }

        const firstItem = grid.querySelector('.pdf-thumbnail') as HTMLElement | null;
        if (!firstItem) {
            return { batchSize: 12, rowHeight: 300 };
        }

        const gridStyles = window.getComputedStyle(grid);
        const columnGap = parseFloat(gridStyles.columnGap || gridStyles.gap || '0');
        const rowGap = parseFloat(gridStyles.rowGap || gridStyles.gap || '0');

        const itemRect = firstItem.getBoundingClientRect();
        const itemWidth = itemRect.width;
        const itemHeight = itemRect.height;

        if (!itemWidth || !itemHeight) {
            return { batchSize: 12, rowHeight: 300 };
        }

        const columns = Math.max(1, Math.floor((grid.clientWidth + columnGap) / (itemWidth + columnGap)));
        const visibleRows = Math.max(1, Math.ceil((grid.clientHeight + rowGap) / (itemHeight + rowGap)));
        const rowsToLoad = visibleRows + 1;

        return {
            batchSize: columns * rowsToLoad,
            rowHeight: itemHeight + rowGap
        };
    };

    const initPdfThumbnails = async (pdfDoc: any) => {
        const totalPages = pdfDoc.numPages;
        setPdfState({
            totalPages: totalPages,
            pdfDoc: pdfDoc,
            thumbnails: Array(totalPages).fill(null),
            renderedPages: 0,
            viewMode: 'grid',
            currentPage: null,
            fullPageUrl: null
        });
    };

    const loadMorePdfThumbnails = async () => {
        if (!pdfState || pdfThumbLoading) return;
        if (pdfState.renderedPages >= pdfState.totalPages) return;
        
        // Find the first missing page
        const nextIndex = pdfState.thumbnails.findIndex((item) => item === null);
        if (nextIndex === -1) return;
        
        const { batchSize } = getPdfGridMetrics();
        await renderPdfThumbnailBatch(pdfState.pdfDoc, nextIndex + 1, batchSize);
    };

    useEffect(() => {
        if (!pdfState || pdfState.viewMode !== 'grid') return;
        if (pdfThumbLoading) return;
        if (pdfState.renderedPages > 0) return;
        if (!pdfState.pdfDoc) return;

        loadMorePdfThumbnails();
    }, [pdfState?.pdfDoc, pdfState?.viewMode, pdfState?.renderedPages, pdfThumbLoading]);

    useEffect(() => {
        if (!pdfState || pdfState.viewMode !== 'grid') return;
        
        // Find the first placeholder to observe (the "frontier" of rendered content)
        const firstNullIndex = pdfState.thumbnails.findIndex(t => t === null);
        if (firstNullIndex === -1) return;

        const targetId = `pdf-thumb-${firstNullIndex}`;
        const target = document.getElementById(targetId);
        const grid = pdfGridRef.current;

        if (!target || !grid) return;

        const { rowHeight } = getPdfGridMetrics();
        const rootMargin = Number.isFinite(rowHeight) && rowHeight > 0
            ? `${Math.ceil(rowHeight)}px 0px`
            : '600px 0px';

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry.isIntersecting) {
                    loadMorePdfThumbnails();
                }
            },
            {
                root: grid,
                rootMargin,
                threshold: 0
            }
        );

        observer.observe(target);
        return () => observer.disconnect();
    }, [pdfState?.thumbnails, pdfState?.viewMode, pdfThumbLoading]);

    const renderPdfFullPage = async (pageNum: number) => {
        if (!pdfState?.pdfDoc) return;
        try {
            setPdfPageLoading(true);
            const page = await pdfState.pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.2 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');

            if (!context) return;

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };

            await page.render(renderContext).promise;
            const pageUrl = canvas.toDataURL('image/png');

            setPdfState(prev => prev ? {
                ...prev,
                viewMode: 'single',
                currentPage: pageNum,
                fullPageUrl: pageUrl
            } : prev);
        } catch (err) {
            console.error('PDF page render error:', err);
            setError('PDF页面渲染失败');
        } finally {
            setPdfPageLoading(false);
        }
    };

    const goToPdfPrevPage = async () => {
        if (!pdfState?.currentPage) return;
        const prevPage = Math.max(1, pdfState.currentPage - 1);
        if (prevPage === pdfState.currentPage) return;
        await renderPdfFullPage(prevPage);
    };

    const goToPdfNextPage = async () => {
        if (!pdfState?.currentPage) return;
        const nextPage = Math.min(pdfState.totalPages, pdfState.currentPage + 1);
        if (nextPage === pdfState.currentPage) return;
        await renderPdfFullPage(nextPage);
    };

    const backToPdfGrid = () => {
        setPdfState(prev => prev ? {
            ...prev,
            viewMode: 'grid',
            currentPage: null,
            fullPageUrl: null
        } : prev);
    };

    const handleCopyContent = async () => {
        if (!previewFile?.content) return;

        try {
            let textToCopy = previewFile.content;
            
            // For CSV, convert to plain text
            if (previewFile.type === 'csv') {
                textToCopy = previewFile.content;
            }
            
            await navigator.clipboard.writeText(textToCopy);
            setCopySuccess(true);
            
            // Reset success message after 2 seconds
            setTimeout(() => {
                setCopySuccess(false);
            }, 2000);
        } catch (err) {
            console.error('Copy failed:', err);
            setError('复制失败，请手动复制');
        }
    };

    const toggleFullscreen = async () => {
        if (!previewContainerRef.current) return;

        try {
            if (!document.fullscreenElement) {
                await previewContainerRef.current.requestFullscreen();
                setIsPreviewFullscreen(true);
            } else {
                await document.exitFullscreen();
                setIsPreviewFullscreen(false);
            }
        } catch (err) {
            console.error('Fullscreen error:', err);
        }
    };

    // Listen for fullscreen change events
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsPreviewFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    const handleDelete = (file: FileInfo) => {
        setConfirmDelete({ file, show: true });
    };

    const confirmDeleteAction = async () => {
        if (!confirmDelete) return;

        const file = confirmDelete.file;
        setConfirmDelete(null);
        setError(null);

        try {
            const filePath = getFilePath(file.name);
            const response = await fetch(`api/delete?file=${encodeURIComponent(filePath)}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (!response.ok) {
                throw new Error('Delete failed');
            }

            await loadFiles(currentPath);
            setSelectedFiles(prev => {
                const newSelected = new Set(prev);
                newSelected.delete(file.name);
                return newSelected;
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Delete failed');
        }
    };

    const handleBatchDelete = () => {
        if (selectedFiles.size === 0) return;
        setConfirmBatchDelete({ files: Array.from(selectedFiles), show: true });
    };

    const confirmBatchDeleteAction = async () => {
        if (!confirmBatchDelete) return;

        const filesToDelete = confirmBatchDelete.files;
        setConfirmBatchDelete(null);
        setError(null);

        try {
            // Delete files one by one
            for (const fileName of filesToDelete) {
                const filePath = getFilePath(fileName);
                const response = await fetch(`api/delete?file=${encodeURIComponent(filePath)}`, {
                    method: 'DELETE',
                    headers: getAuthHeaders()
                });

                if (!response.ok) {
                    throw new Error(`Failed to delete ${fileName}`);
                }
            }

            await loadFiles(currentPath);
            setSelectedFiles(new Set());
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Batch delete failed');
            // Reload to show current state
            await loadFiles(currentPath);
        }
    };

    const formatSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    const formatDate = (timestamp: number): string => {
        const date = new Date(timestamp * 1000);
        return date.toLocaleString();
    };

    const renderPreview = () => {
        if (!previewFile && !previewLoading) return null;

        // Show loading overlay
        if (previewLoading) {
            return (
                <div className="preview-overlay">
                    <div className="preview-loading">
                        <div className="loading-spinner"></div>
                        <div className="loading-text">加载预览中...</div>
                    </div>
                </div>
            );
        }

        if (!previewFile) return null;

        // Get language from file extension for syntax highlighting
        const getLanguage = (filename: string): string => {
            const ext = filename.split('.').pop()?.toLowerCase() || '';
            const langMap: { [key: string]: string } = {
                'js': 'javascript',
                'jsx': 'javascript',
                'ts': 'typescript',
                'tsx': 'typescript',
                'py': 'python',
                'rb': 'ruby',
                'go': 'go',
                'java': 'java',
                'c': 'c',
                'cpp': 'cpp',
                'h': 'c',
                'hpp': 'cpp',
                'rs': 'rust',
                'php': 'php',
                'sh': 'bash',
                'bash': 'bash',
                'sql': 'sql',
                'json': 'json',
                'xml': 'xml',
                'yaml': 'yaml',
                'yml': 'yaml',
                'css': 'css',
                'scss': 'scss',
                'sass': 'sass',
                'less': 'less',
                'html': 'html',
                'htm': 'html',
                'r': 'r',
                'swift': 'swift',
                'kt': 'kotlin',
                'dart': 'dart',
            };
            return langMap[ext] || ext;
        };

        // Highlight code
        const highlightCode = (code: string, language: string): string => {
            try {
                if (language && hljs.getLanguage(language)) {
                    return hljs.highlight(code, { language }).value;
                }
                return hljs.highlightAuto(code).value;
            } catch (err) {
                console.error('Highlight error:', err);
                return code;
            }
        };

        // Parse CSV to HTML table
        const renderCsvTable = (csvContent: string): string => {
            try {
                const parsed = Papa.parse(csvContent, { header: true });
                if (!parsed.data || parsed.data.length === 0) {
                    return '<p>无法解析CSV文件或文件为空</p>';
                }
                const headers = parsed.meta.fields || [];
                const rows = parsed.data as any[];
                
                return `
                    <table>
                        <thead>
                            <tr>${headers.map(h => `<th>${h || ''}</th>`).join('')}</tr>
                        </thead>
                        <tbody>
                            ${rows.map(row => `<tr>${headers.map(h => `<td>${row[h] || ''}</td>`).join('')}</tr>`).join('')}
                        </tbody>
                    </table>
                `;
            } catch (err) {
                console.error('CSV parse error:', err);
                return '<p>解析CSV文件时出错</p>';
            }
        };

        return (
            <div className="preview-overlay" onClick={closePreview}>
                <div 
                    ref={previewContainerRef}
                    className={`preview-container ${isPreviewFullscreen ? 'fullscreen' : ''}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="preview-header">
                        <h3>{previewFile.file.name}</h3>
                        <div className="preview-header-actions">
                            {(previewFile.type === 'code' || previewFile.type === 'csv' || previewFile.type === 'html') && (
                                <button 
                                    className={`preview-action-btn copy-btn ${copySuccess ? 'copy-success' : ''}`}
                                    onClick={handleCopyContent}
                                    title="复制内容"
                                >
                                    {copySuccess ? (
                                        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                        </svg>
                                    ) : (
                                        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                                        </svg>
                                    )}
                                </button>
                            )}
                            <button 
                                className="preview-action-btn" 
                                onClick={toggleFullscreen}
                                title={isPreviewFullscreen ? '退出全屏' : '全屏'}
                            >
                                {isPreviewFullscreen ? (
                                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
                                    </svg>
                                ) : (
                                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                                    </svg>
                                )}
                            </button>
                            <button className="preview-action-btn close-btn" onClick={closePreview} title="关闭">
                                ×
                            </button>
                        </div>
                    </div>
                    <div className="preview-body">
                        {previewFile.type === 'image' && previewFile.content && (
                            <img src={previewFile.content} alt={previewFile.file.name} />
                        )}
                        {previewFile.type === 'markdown' && previewFile.content && (
                            <div 
                                className="markdown-preview" 
                                dangerouslySetInnerHTML={{ __html: marked(previewFile.content) as string }}
                            />
                        )}
                        {previewFile.type === 'html' && previewFile.content && (
                            <div className="html-preview-stage">
                                <div className="html-preview-wrapper">
                                    <iframe 
                                        srcDoc={previewFile.content}
                                        className="html-preview"
                                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                                    />
                                </div>
                            </div>
                        )}
                        {previewFile.type === 'code' && previewFile.content && (
                            <pre className="code-preview">
                                <code 
                                    className={`hljs language-${getLanguage(previewFile.file.name)}`}
                                    dangerouslySetInnerHTML={{ 
                                        __html: highlightCode(previewFile.content, getLanguage(previewFile.file.name))
                                    }}
                                />
                            </pre>
                        )}
                        {previewFile.type === 'video' && previewFile.content && (
                            <video 
                                className="video-preview" 
                                controls 
                                src={previewFile.content}
                            >
                                您的浏览器不支持视频播放
                            </video>
                        )}
                        {previewFile.type === 'csv' && previewFile.content && (
                            <div className="table-preview-container">
                                <div 
                                    className="csv-preview" 
                                    dangerouslySetInnerHTML={{ __html: renderCsvTable(previewFile.content) }}
                                />
                            </div>
                        )}
                        {previewFile.type === 'xlsx' && previewFile.content && (
                            <div className="table-preview-container">
                                <div 
                                    className="xlsx-preview" 
                                    dangerouslySetInnerHTML={{ __html: previewFile.content }}
                                />
                            </div>
                        )}
                        {previewFile.type === 'docx' && previewFile.content && (
                            <div 
                                className="docx-preview" 
                                dangerouslySetInnerHTML={{ __html: previewFile.content }}
                            />
                        )}
                        {previewFile.type === 'pdf' && pdfState && (
                            <div className="pdf-preview-container">
                                {pdfState.viewMode === 'grid' && (
                                    <>
                                        <div className="pdf-grid" ref={pdfGridRef}>
                                            {pdfState.thumbnails.map((thumbnail, index) => (
                                                <button
                                                    key={index}
                                                    id={`pdf-thumb-${index}`}
                                                    className={`pdf-thumbnail ${thumbnail ? 'loaded' : 'loading'}`}
                                                    onClick={() => thumbnail && renderPdfFullPage(index + 1)}
                                                    disabled={!thumbnail}
                                                    title={`第 ${index + 1} 页`}
                                                >
                                                    {thumbnail ? (
                                                        <img
                                                            src={thumbnail}
                                                            alt={`Page ${index + 1}`}
                                                            className="pdf-thumbnail-image"
                                                        />
                                                    ) : (
                                                        <div className="pdf-thumbnail-placeholder">
                                                            <div className="pdf-thumb-spinner"></div>
                                                        </div>
                                                    )}
                                                    <div className="pdf-thumbnail-label">{index + 1}</div>
                                                </button>
                                            ))}
                                        </div>
                                        {pdfThumbLoading && (
                                            <div className="pdf-load-more">
                                                <div className="pdf-load-more-hint">加载中...</div>
                                            </div>
                                        )}
                                    </>
                                )}

                                {pdfState.viewMode === 'single' && (
                                    <div className="pdf-single-view">
                                        <div className="pdf-single-header">
                                            <button className="pdf-back-btn" onClick={backToPdfGrid}>
                                                返回缩略图
                                            </button>
                                            <div className="pdf-page-info">
                                                第 {pdfState.currentPage} 页 / 共 {pdfState.totalPages} 页
                                            </div>
                                            <div className="pdf-nav-group">
                                                <button className="pdf-nav-btn" onClick={goToPdfPrevPage} disabled={pdfState.currentPage === 1}>
                                                    上一页
                                                </button>
                                                <button className="pdf-nav-btn" onClick={goToPdfNextPage} disabled={pdfState.currentPage === pdfState.totalPages}>
                                                    下一页
                                                </button>
                                            </div>
                                        </div>
                                        <div className="pdf-single-body">
                                            {pdfPageLoading && (
                                                <div className="pdf-page-loading">加载中...</div>
                                            )}
                                            {pdfState.fullPageUrl && (
                                                <img
                                                    src={pdfState.fullPageUrl}
                                                    alt={`Page ${pdfState.currentPage}`}
                                                    className="pdf-full-page"
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="file-manager-overlay" onClick={onClose}>
            <div className="file-manager" onClick={(e) => e.stopPropagation()}>
                <div className="file-manager-header">
                    <h2>文件管理器</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="file-manager-body">
                    <div className="breadcrumb">
                        <button
                            className="breadcrumb-btn"
                            onClick={() => setCurrentPath('.')}
                            disabled={currentPath === '.'}
                        >
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                            </svg>
                        </button>
                        {pathHistory.length > 1 && (
                            <button className="breadcrumb-btn" onClick={navigateBack}>
                                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                                </svg>
                            </button>
                        )}
                        <span className="current-path">{currentPath === '.' ? '根目录' : currentPath}</span>
                    </div>

                    <div className="upload-section">
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={handleFileUpload}
                            disabled={uploading}
                            style={{ display: 'none' }}
                        />
                        <input
                            ref={folderInputRef}
                            type="file"
                            multiple
                            onChange={handleFolderUpload}
                            disabled={uploading}
                            style={{ display: 'none' }}
                            {...({ webkitdirectory: 'true', directory: 'true' } as any)}
                        />
                        <label className="upload-btn" onClick={() => fileInputRef.current?.click()}>
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" />
                            </svg>
                            {uploading ? '上传中...' : '上传文件'}
                        </label>
                        <label className="upload-btn" onClick={() => folderInputRef.current?.click()}>
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" />
                            </svg>
                            {uploading ? '上传中...' : '上传文件夹'}
                        </label>
                        {selectedFiles.size > 0 && (
                            <>
                                <button className="batch-download-btn" onClick={handleBatchDownload}>
                                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" />
                                    </svg>
                                    下载选中 ({selectedFiles.size})
                                </button>
                                <button className="batch-delete-btn" onClick={handleBatchDelete}>
                                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                                    </svg>
                                    删除选中 ({selectedFiles.size})
                                </button>
                            </>
                        )}
                        <button className="refresh-btn" onClick={() => loadFiles(currentPath)} disabled={loading}>
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                            </svg>
                            {loading ? '加载中...' : '刷新'}
                        </button>
                    </div>

                    {batchUploadStats && (
                        <div className="batch-upload-stats">
                            <div className="stats-header">
                                <span className="stats-title">上传进度</span>
                                <span className="stats-files">
                                    {batchUploadStats.completedFiles} / {batchUploadStats.totalFiles} 个文件
                                </span>
                            </div>
                            <div className="stats-progress-bar">
                                <div 
                                    className="stats-progress-fill" 
                                    style={{ 
                                        width: `${(batchUploadStats.uploadedBytes / batchUploadStats.totalBytes) * 100}%` 
                                    }}
                                />
                            </div>
                            <div className="stats-details">
                                <div className="stats-row">
                                    <span className="stats-label">已上传:</span>
                                    <span className="stats-value">
                                        {formatBytes(batchUploadStats.uploadedBytes)} / {formatBytes(batchUploadStats.totalBytes)}
                                    </span>
                                </div>
                                <div className="stats-row">
                                    <span className="stats-label">速度:</span>
                                    <span className="stats-value">{formatSpeed(batchUploadStats.speed)}</span>
                                </div>
                                <div className="stats-row">
                                    <span className="stats-label">剩余时间:</span>
                                    <span className="stats-value">{formatTime(batchUploadStats.remainingTime)}</span>
                                </div>
                                {batchUploadStats.currentFile && (
                                    <div className="stats-row stats-current-file">
                                        <span className="stats-label">当前文件:</span>
                                        <span className="stats-value stats-filename-ellipsis">
                                            {batchUploadStats.currentFile}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {Object.keys(uploadProgress).length > 0 && (
                        <div className="upload-progress">
                            {Object.entries(uploadProgress).map(([id, progress]) => (
                                <div key={id} className="progress-item">
                                    <div className="progress-info">
                                        <span className="progress-filename">{progress.filename}</span>
                                        <span className="progress-percent">
                                            {Math.round((progress.progress / progress.total) * 100)}%
                                        </span>
                                    </div>
                                    <div className="progress-bar">
                                        <div 
                                            className="progress-bar-fill" 
                                            style={{ width: `${(progress.progress / progress.total) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {downloadProgress && (
                        <div className="download-progress">
                            <div className="progress-item">
                                <div className="progress-info">
                                    <span className="progress-filename">下载: {downloadProgress.filename}</span>
                                    <span className="progress-percent">{Math.round(downloadProgress.progress)}%</span>
                                </div>
                                <div className="progress-bar">
                                    <div 
                                        className="progress-bar-fill" 
                                        style={{ width: `${downloadProgress.progress}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {batchDownloadProgress && (
                        <div className="batch-download-progress">
                            {batchDownloadProgress.status === 'preparing' && (
                                <div className="download-preparing">
                                    <div className="preparing-spinner"></div>
                                    <div className="preparing-text">
                                        正在打包 {batchDownloadProgress.fileCount} 个文件...
                                    </div>
                                </div>
                            )}
                            
                            {batchDownloadProgress.status === 'downloading' && (
                                <div className="download-stats">
                                    <div className="stats-header">
                                        <span className="stats-title">下载进度</span>
                                        <span className="stats-files">
                                            {batchDownloadProgress.fileCount} 个文件
                                        </span>
                                    </div>
                                    <div className="stats-progress-bar">
                                        <div 
                                            className="stats-progress-fill" 
                                            style={{ 
                                                width: `${(batchDownloadProgress.downloaded / batchDownloadProgress.totalBytes) * 100}%` 
                                            }}
                                        />
                                    </div>
                                    <div className="stats-details">
                                        <div className="stats-row">
                                            <span className="stats-label">已下载:</span>
                                            <span className="stats-value">
                                                {formatBytes(batchDownloadProgress.downloaded)} / {formatBytes(batchDownloadProgress.totalBytes)}
                                            </span>
                                        </div>
                                        <div className="stats-row">
                                            <span className="stats-label">速度:</span>
                                            <span className="stats-value">{formatSpeed(batchDownloadProgress.speed)}</span>
                                        </div>
                                        <div className="stats-row">
                                            <span className="stats-label">剩余时间:</span>
                                            <span className="stats-value">{formatTime(batchDownloadProgress.remainingTime)}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {batchDownloadProgress.status === 'complete' && (
                                <div className="download-complete">
                                    <div className="complete-icon">
                                        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                        </svg>
                                    </div>
                                    <div className="complete-text">
                                        下载完成！{batchDownloadProgress.fileCount} 个文件已打包
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {error && (
                        <div className="error-message">
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                            </svg>
                            {error}
                        </div>
                    )}

                    <div className="files-list">
                        {files.length === 0 ? (
                            <div className="no-files">暂无文件</div>
                        ) : (
                            <table>
                                <thead>
                                    <tr>
                                        <th style={{ width: '40px' }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedFiles.size === files.length && files.length > 0}
                                                onChange={(e) => {
                                                    const target = e.target as HTMLInputElement;
                                                    if (target.checked) {
                                                        setSelectedFiles(new Set(files.map(f => f.name)));
                                                    } else {
                                                        setSelectedFiles(new Set());
                                                    }
                                                }}
                                            />
                                        </th>
                                        <th>文件名</th>
                                        <th>大小</th>
                                        <th>修改时间</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {files.map((file) => (
                                        <tr key={file.name} className={file.isDir ? 'folder-row' : ''}>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedFiles.has(file.name)}
                                                    onChange={() => toggleFileSelection(file.name)}
                                                />
                                            </td>
                                            <td className="filename" onClick={() => handlePreview(file)}>
                                                <svg className="file-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                    {file.isDir ? (
                                                        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                                                    ) : (
                                                        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                                                    )}
                                                </svg>
                                                {file.name}
                                                {file.isDir && (
                                                    <svg className="folder-arrow" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                                                    </svg>
                                                )}
                                            </td>
                                            <td>{file.isDir ? '-' : formatSize(file.size!)}</td>
                                            <td>{formatDate(file.time)}</td>
                                            <td>
                                                {!file.isDir && (
                                                    <button
                                                        className="action-btn download-btn"
                                                        onClick={() => handleDownload(file)}
                                                        title="下载"
                                                    >
                                                        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                            <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" />
                                                        </svg>
                                                    </button>
                                                )}
                                                <button
                                                    className="action-btn delete-btn"
                                                    onClick={() => handleDelete(file)}
                                                    title="删除"
                                                >
                                                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                                                    </svg>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>

            {confirmDelete?.show && (
                <div className="confirm-dialog-overlay" onClick={() => setConfirmDelete(null)}>
                    <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="confirm-dialog-header">
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                            </svg>
                            <h3>确认删除</h3>
                        </div>
                        <div className="confirm-dialog-body">
                            <p>确定要删除{confirmDelete.file.isDir ? '文件夹' : '文件'} <strong>{confirmDelete.file.name}</strong> 吗？</p>
                            {confirmDelete.file.isDir && (
                                <p className="warning-text">注意：删除文件夹将同时删除其中所有内容！</p>
                            )}
                        </div>
                        <div className="confirm-dialog-footer">
                            <button className="confirm-cancel-btn" onClick={() => setConfirmDelete(null)}>
                                取消
                            </button>
                            <button className="confirm-delete-btn" onClick={confirmDeleteAction}>
                                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                                </svg>
                                删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmBatchDelete?.show && (
                <div className="confirm-dialog-overlay" onClick={() => setConfirmBatchDelete(null)}>
                    <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="confirm-dialog-header">
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                            </svg>
                            <h3>确认批量删除</h3>
                        </div>
                        <div className="confirm-dialog-body">
                            <p>确定要删除选中的 <strong>{confirmBatchDelete.files.length}</strong> 个文件/文件夹吗？</p>
                            <p className="warning-text">注意：此操作不可恢复！</p>
                            <div className="batch-delete-list">
                                {confirmBatchDelete.files.slice(0, 10).map(fileName => (
                                    <div key={fileName} className="batch-delete-item">{fileName}</div>
                                ))}
                                {confirmBatchDelete.files.length > 10 && (
                                    <div className="batch-delete-more">还有 {confirmBatchDelete.files.length - 10} 个...</div>
                                )}
                            </div>
                        </div>
                        <div className="confirm-dialog-footer">
                            <button className="confirm-cancel-btn" onClick={() => setConfirmBatchDelete(null)}>
                                取消
                            </button>
                            <button className="confirm-delete-btn" onClick={confirmBatchDeleteAction}>
                                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                                </svg>
                                删除全部
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {confirmDownload?.show && (
                <div className="confirm-dialog-overlay" onClick={() => setConfirmDownload(null)}>
                    <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="confirm-dialog-header">
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M11 15h2v-2h-2v2zm0-8h2V5h-2v2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/>
                            </svg>
                            <h3>无法预览</h3>
                        </div>
                        <div className="confirm-dialog-body">
                            <p>此文件类型 <strong>.{confirmDownload.file.name.split('.').pop()}</strong> 暂不支持在线预览。</p>
                            <p>是否下载到本地查看？</p>
                        </div>
                        <div className="confirm-dialog-footer">
                            <button className="confirm-cancel-btn" onClick={() => setConfirmDownload(null)}>
                                取消
                            </button>
                            <button className="confirm-download-btn" onClick={() => {
                                handleDownload(confirmDownload.file);
                                setConfirmDownload(null);
                            }}>
                                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" />
                                </svg>
                                下载文件
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {renderPreview()}
        </div>
    );
};
