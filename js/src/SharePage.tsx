import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
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

interface SharePageProps {
    token: string;
    basePath: string;
}

export const SharePage = ({ token, basePath }: SharePageProps) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [needPassword, setNeedPassword] = useState(false);
    const [password, setPassword] = useState('');
    const [authenticated, setAuthenticated] = useState(false);
    const [shareInfo, setShareInfo] = useState<any>(null);
    const [files, setFiles] = useState<FileInfo[]>([]);
    const [currentPath, setCurrentPath] = useState('.');
    const [previewFile, setPreviewFile] = useState<{ file: FileInfo; content: string | null; type: string } | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
    const [singleFileAutoPreview, setSingleFileAutoPreview] = useState(false);
    const [inlinePreview, setInlinePreview] = useState<{ file: FileInfo; content: string | null; type: string } | null>(null);

    // Draggable exit button state
    const [exitBtnPos, setExitBtnPos] = useState({ x: -1, y: 16 }); // -1 = uninitialized
    const [exitBtnDocked, setExitBtnDocked] = useState<'none' | 'left' | 'right'>('none');
    const exitBtnRef = useRef<HTMLButtonElement>(null);
    const dragState = useRef({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false });

    // Initialize exit button position
    useEffect(() => {
        if (isPreviewFullscreen && exitBtnPos.x === -1) {
            setExitBtnPos({ x: window.innerWidth - 56, y: 16 });
        }
    }, [isPreviewFullscreen]);

    const handleDragStart = useCallback((e: MouseEvent | TouchEvent) => {
        e.preventDefault();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        dragState.current = { dragging: true, startX: clientX, startY: clientY, startPosX: exitBtnPos.x, startPosY: exitBtnPos.y, moved: false };
        setExitBtnDocked('none');
    }, [exitBtnPos]);

    useEffect(() => {
        const handleMove = (e: MouseEvent | TouchEvent) => {
            if (!dragState.current.dragging) return;
            const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
            const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
            const dx = clientX - dragState.current.startX;
            const dy = clientY - dragState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragState.current.moved = true;
            const btnSize = 40;
            const newX = Math.max(-btnSize / 2, Math.min(window.innerWidth - btnSize / 2, dragState.current.startPosX + dx));
            const newY = Math.max(0, Math.min(window.innerHeight - btnSize, dragState.current.startPosY + dy));
            setExitBtnPos({ x: newX, y: newY });
        };
        const handleEnd = () => {
            if (!dragState.current.dragging) return;
            dragState.current.dragging = false;
            // Snap to nearest edge
            const btnSize = 40;
            const { x } = exitBtnPos;
            const centerX = x + btnSize / 2;
            if (centerX < window.innerWidth / 2) {
                setExitBtnPos(prev => ({ ...prev, x: -btnSize / 3 }));
                setExitBtnDocked('left');
            } else {
                setExitBtnPos(prev => ({ ...prev, x: window.innerWidth - btnSize * 2 / 3 }));
                setExitBtnDocked('right');
            }
        };
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleEnd);
        window.addEventListener('touchmove', handleMove);
        window.addEventListener('touchend', handleEnd);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleEnd);
            window.removeEventListener('touchmove', handleMove);
            window.removeEventListener('touchend', handleEnd);
        };
    }, [exitBtnPos]);

    useEffect(() => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `${basePath}js/pdf.worker.min.js`;
    }, []);

    const fetchShareInfo = async (pwd?: string) => {
        try {
            setLoading(true);
            setError(null);
            const params = new URLSearchParams({ token });
            if (pwd) params.set('password', pwd);
            const response = await fetch(`${basePath}api/share/info?${params.toString()}`);
            if (!response.ok) {
                if (response.status === 404) throw new Error('分享链接不存在或已过期');
                throw new Error('加载失败');
            }
            const data = await response.json();
            setShareInfo(data);
            if (data.hasPassword && !data.authenticated) {
                setNeedPassword(true);
                setAuthenticated(false);
            } else {
                setNeedPassword(false);
                setAuthenticated(true);
                if (data.isDir) {
                    loadFiles('.');
                } else {
                    setSingleFileAutoPreview(true);
                }
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const loadFiles = async (path: string) => {
        try {
            setLoading(true);
            const params: Record<string, string> = { token, path };
            if (password) params.password = password;
            const searchParams = new URLSearchParams(params);
            const response = await fetch(`${basePath}api/share/files?${searchParams.toString()}`);
            if (!response.ok) throw new Error('加载文件列表失败');
            const data = await response.json();
            setFiles(data.files || []);
            setCurrentPath(path);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchShareInfo();
    }, [token]);

    // Auto-preview single file shares
    useEffect(() => {
        if (singleFileAutoPreview && shareInfo && !shareInfo.isDir) {
            const fakeFile: FileInfo = { name: shareInfo.name, time: 0, isDir: false };
            handlePreview(fakeFile);
            setSingleFileAutoPreview(false);
        }
    }, [singleFileAutoPreview, shareInfo]);

    const handlePasswordSubmit = async () => {
        setPassword(password);
        await fetchShareInfo(password);
    };

    const handleDownload = (file?: FileInfo) => {
        const params: Record<string, string> = { token };
        if (password) params.password = password;
        if (shareInfo?.isDir && file) {
            const filePath = currentPath === '.' ? file.name : `${currentPath}/${file.name}`;
            params.file = filePath;
        }
        const searchParams = new URLSearchParams(params);
        window.open(`${basePath}api/share/download?${searchParams.toString()}`);
    };

    const getShareUrl = (file: FileInfo, preview: boolean = false) => {
        const filePath = currentPath === '.' ? file.name : `${currentPath}/${file.name}`;
        const params: Record<string, string> = { token };
        if (preview) params.preview = 'true';
        if (password) params.password = password;
        if (shareInfo?.isDir) params.file = filePath;
        return `${basePath}api/share/download?${new URLSearchParams(params).toString()}`;
    };

    const handlePreview = async (file: FileInfo) => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const imageMimeTypes = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'];
        const videoMimeTypes = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
        const audioMimeTypes = ['mp3', 'wav', 'ogg', 'aac', 'flac'];
        const codeMimeTypes = ['js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sass', 'less', 'json', 'xml', 'yaml', 'yml', 'go', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'hpp', 'rs', 'php', 'sh', 'bash', 'sql', 'r', 'swift', 'kt', 'dart'];
        const textMimeTypes = ['txt', 'log', 'conf', 'config', 'ini', 'env'];
        const markdownTypes = ['md', 'markdown'];
        const htmlTypes = ['html', 'htm'];
        const spreadsheetTypes = ['xlsx', 'xls', 'csv'];
        const docTypes = ['docx'];
        const pdfTypes = ['pdf'];

        const canPreview = imageMimeTypes.includes(ext) || videoMimeTypes.includes(ext) || audioMimeTypes.includes(ext) || codeMimeTypes.includes(ext) || textMimeTypes.includes(ext) || markdownTypes.includes(ext) || htmlTypes.includes(ext) || spreadsheetTypes.includes(ext) || docTypes.includes(ext) || pdfTypes.includes(ext);

        // Use inline preview for single file shares, overlay for folder share
        const isInline = !shareInfo?.isDir;
        const setPreview = (val: { file: FileInfo; content: string | null; type: string } | null) => {
            if (isInline) {
                setInlinePreview(val);
            } else {
                setPreviewFile(val);
            }
        };

        if (!canPreview) {
            setPreview({ file, content: null, type: 'unsupported' });
            return;
        }

        const url = getShareUrl(file, true);

        setError(null);
        setPreviewLoading(true);

        try {
            if (imageMimeTypes.includes(ext)) {
                setPreview({ file, content: url, type: 'image' });
            } else if (videoMimeTypes.includes(ext)) {
                setPreview({ file, content: url, type: 'video' });
            } else if (audioMimeTypes.includes(ext)) {
                setPreview({ file, content: url, type: 'audio' });
            } else {
                const response = await fetch(url);
                if (!response.ok) throw new Error('预览加载失败');

                if (markdownTypes.includes(ext)) {
                    const text = await response.text();
                    setPreview({ file, content: text, type: 'markdown' });
                } else if (htmlTypes.includes(ext)) {
                    const text = await response.text();
                    setPreview({ file, content: text, type: 'html' });
                } else if (codeMimeTypes.includes(ext) || textMimeTypes.includes(ext)) {
                    const text = await response.text();
                    setPreview({ file, content: text, type: 'code' });
                } else if (ext === 'csv') {
                    const text = await response.text();
                    setPreview({ file, content: text, type: 'csv' });
                } else if (ext === 'xlsx' || ext === 'xls') {
                    const arrayBuffer = await response.arrayBuffer();
                    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const html = XLSX.utils.sheet_to_html(firstSheet, { header: '', footer: '' });
                    setPreview({ file, content: html, type: 'xlsx' });
                } else if (ext === 'docx') {
                    const arrayBuffer = await response.arrayBuffer();
                    const result = await mammoth.convertToHtml({ arrayBuffer });
                    setPreview({ file, content: result.value, type: 'docx' });
                } else if (pdfTypes.includes(ext)) {
                    const arrayBuffer = await response.arrayBuffer();
                    const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
                    const blobUrl = window.URL.createObjectURL(blob);
                    setPreview({ file, content: blobUrl, type: 'pdf' });
                }
            }
        } catch (err: any) {
            setError(err.message || '预览加载失败');
        } finally {
            setPreviewLoading(false);
        }
    };

    const navigateToFolder = (folderName: string) => {
        const newPath = currentPath === '.' ? folderName : `${currentPath}/${folderName}`;
        loadFiles(newPath);
    };

    const navigateUp = () => {
        if (currentPath === '.') return;
        const parts = currentPath.split('/');
        parts.pop();
        loadFiles(parts.length === 0 ? '.' : parts.join('/'));
    };

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    const formatDate = (timestamp: number): string => {
        return new Date(timestamp * 1000).toLocaleString('zh-CN');
    };

    const getLanguage = (filename: string): string => {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const langMap: Record<string, string> = {
            js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
            py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
            c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
            php: 'php', sh: 'bash', bash: 'bash', sql: 'sql',
            css: 'css', scss: 'scss', sass: 'sass', less: 'less',
            json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml',
            r: 'r', swift: 'swift', kt: 'kotlin', dart: 'dart',
        };
        return langMap[ext] || 'plaintext';
    };

    const highlightCode = (code: string, language: string): string => {
        try {
            if (hljs.getLanguage(language)) {
                return hljs.highlight(code, { language }).value;
            }
            return hljs.highlightAuto(code).value;
        } catch {
            return code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
    };

    const renderCsvTable = (csvText: string): string => {
        const result = Papa.parse(csvText, { header: false, skipEmptyLines: true });
        const rows = result.data as string[][];
        if (rows.length === 0) return '<p>空表格</p>';
        let html = '<table class="csv-table"><thead><tr>';
        rows[0].forEach(cell => { html += `<th>${cell.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</th>`; });
        html += '</tr></thead><tbody>';
        for (let i = 1; i < rows.length; i++) {
            html += '<tr>';
            rows[i].forEach(cell => { html += `<td>${cell.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`; });
            html += '</tr>';
        }
        html += '</tbody></table>';
        return html;
    };

    if (loading && !shareInfo) {
        return (
            <div className="share-page">
                <div className="share-page-loading">
                    <div className="preparing-spinner"></div>
                    <p>加载中...</p>
                </div>
            </div>
        );
    }

    if (error && !shareInfo) {
        return (
            <div className="share-page">
                <div className="share-page-error">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="48" height="48">
                        <path fill="#ff6b6b" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                    </svg>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    if (needPassword && !authenticated) {
        return (
            <div className="share-page">
                <div className="share-page-password">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="48" height="48">
                        <path fill="#5dade2" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                    </svg>
                    <h2>此分享需要密码</h2>
                    <p>{shareInfo?.name || '文件'}</p>
                    <div className="share-password-form">
                        <input
                            type="password"
                            value={password}
                            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                            onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                            placeholder="请输入访问密码"
                            className="share-input"
                            autoFocus
                        />
                        <button className="share-password-btn" onClick={handlePasswordSubmit}>
                            访问
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="share-page">
            <div className="share-page-header">
                <h1>
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">
                        <path fill="#5dade2" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" />
                    </svg>
                    {shareInfo?.name || '分享'}
                </h1>
                <div className="share-page-header-right">
                    {shareInfo?.expiresAt && (
                        <span className="share-expires-info">
                            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="#aaa" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" /></svg>
                            {new Date(shareInfo.expiresAt) > new Date()
                                ? `${new Date(shareInfo.expiresAt).toLocaleString('zh-CN')} 过期`
                                : '已过期'}
                        </span>
                    )}
                    {!shareInfo?.isDir && (
                        <button className="share-download-btn" onClick={() => handleDownload()}>
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" />
                            </svg>
                            下载
                        </button>
                    )}
                    {!shareInfo?.isDir && inlinePreview && !isPreviewFullscreen && (
                        <button className="share-download-btn" onClick={() => setIsPreviewFullscreen(true)}>
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                            </svg>
                            全屏
                        </button>
                    )}
                </div>
            </div>

            {shareInfo?.isDir ? (
                <div className="share-page-files">
                    {currentPath !== '.' && (
                        <div className="share-breadcrumb">
                            <button onClick={navigateUp} className="share-back-btn">← 返回上级</button>
                            <span className="share-current-path">{currentPath}</span>
                        </div>
                    )}

                    {loading ? (
                        <div className="share-page-loading">
                            <div className="preparing-spinner"></div>
                        </div>
                    ) : files.length === 0 ? (
                        <div className="share-empty">空文件夹</div>
                    ) : (
                        <table className="share-file-table">
                            <thead>
                                <tr>
                                    <th>文件名</th>
                                    <th>大小</th>
                                    <th>时间</th>
                                    <th>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {files.map(file => (
                                    <tr key={file.name}>
                                        <td>
                                            {file.isDir ? (
                                                <span className="share-folder-name" onClick={() => navigateToFolder(file.name)}>
                                                    <svg viewBox="0 0 24 24" width="16" height="16" style={{ verticalAlign: 'middle', marginRight: '4px' }}><path fill="#f0c040" d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" /></svg>
                                                    {file.name}
                                                </span>
                                            ) : (
                                                <span className="share-file-name" onClick={() => handlePreview(file)}>
                                                    <svg viewBox="0 0 24 24" width="16" height="16" style={{ verticalAlign: 'middle', marginRight: '4px' }}><path fill="#90caf9" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" /></svg>
                                                    {file.name}
                                                </span>
                                            )}
                                        </td>
                                        <td>{file.isDir ? '-' : formatBytes(file.size || 0)}</td>
                                        <td>{formatDate(file.time)}</td>
                                        <td>
                                            {!file.isDir && (
                                                <>
                                                    <button className="share-action-btn" onClick={() => handlePreview(file)} title="预览">
                                                        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="#aaa" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" /></svg>
                                                    </button>
                                                    <button className="share-action-btn" onClick={() => handleDownload(file)} title="下载">
                                                        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="#aaa" d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" /></svg>
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            ) : null}

            {/* Inline preview for single file shares */}
            {!shareInfo?.isDir && (
                <div className={`share-inline-preview ${isPreviewFullscreen ? 'share-inline-fullscreen' : ''}`}>
                    {isPreviewFullscreen && (
                        <button
                            ref={exitBtnRef}
                            className={`share-fullscreen-exit ${exitBtnDocked !== 'none' ? 'docked' : ''}`}
                            style={{ left: `${exitBtnPos.x}px`, top: `${exitBtnPos.y}px` }}
                            onMouseDown={handleDragStart}
                            onTouchStart={handleDragStart}
                            onClick={(e) => { if (!dragState.current.moved) { e.stopPropagation(); setIsPreviewFullscreen(false); } }}
                            title="退出全屏"
                        >
                            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#fff" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" /></svg>
                        </button>
                    )}
                    {previewLoading && (
                        <div className="share-page-loading"><div className="preparing-spinner"></div></div>
                    )}
                    {inlinePreview && inlinePreview.type === 'image' && inlinePreview.content && (
                        <img src={inlinePreview.content} alt={inlinePreview.file.name} style={{ maxWidth: '100%', maxHeight: '80vh' }} />
                    )}
                    {inlinePreview && inlinePreview.type === 'video' && inlinePreview.content && (
                        <video src={inlinePreview.content} controls style={{ maxWidth: '100%', maxHeight: '80vh' }} />
                    )}
                    {inlinePreview && inlinePreview.type === 'audio' && inlinePreview.content && (
                        <audio src={inlinePreview.content} controls />
                    )}
                    {inlinePreview && inlinePreview.type === 'markdown' && inlinePreview.content && (
                        <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: marked(inlinePreview.content) as string }} />
                    )}
                    {inlinePreview && inlinePreview.type === 'html' && inlinePreview.content && (
                        <div className="html-preview-stage">
                            <div className="html-preview-wrapper">
                                <iframe srcDoc={inlinePreview.content} className="html-preview" sandbox="allow-scripts allow-forms allow-popups allow-modals" />
                            </div>
                        </div>
                    )}
                    {inlinePreview && inlinePreview.type === 'code' && inlinePreview.content && (
                        <pre className="code-preview">
                            <code
                                className={`hljs language-${getLanguage(inlinePreview.file.name)}`}
                                dangerouslySetInnerHTML={{ __html: highlightCode(inlinePreview.content, getLanguage(inlinePreview.file.name)) }}
                            />
                        </pre>
                    )}
                    {inlinePreview && inlinePreview.type === 'csv' && inlinePreview.content && (
                        <div className="table-preview-container">
                            <div className="csv-preview" dangerouslySetInnerHTML={{ __html: renderCsvTable(inlinePreview.content) }} />
                        </div>
                    )}
                    {inlinePreview && inlinePreview.type === 'xlsx' && inlinePreview.content && (
                        <div className="table-preview-container">
                            <div className="xlsx-preview" dangerouslySetInnerHTML={{ __html: inlinePreview.content }} />
                        </div>
                    )}
                    {inlinePreview && inlinePreview.type === 'docx' && inlinePreview.content && (
                        <div className="docx-preview" dangerouslySetInnerHTML={{ __html: inlinePreview.content }} />
                    )}
                    {inlinePreview && inlinePreview.type === 'pdf' && inlinePreview.content && (
                        <iframe src={inlinePreview.content} style={{ width: '100%', height: '80vh', border: 'none', background: '#fff', borderRadius: '4px' }} />
                    )}
                    {inlinePreview && inlinePreview.type === 'unsupported' && (
                        <div className="share-unsupported-preview">
                            <svg viewBox="0 0 24 24" width="48" height="48"><path fill="#666" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" /></svg>
                            <p>此文件类型暂不支持预览</p>
                            <button className="share-download-btn" onClick={() => handleDownload()}>
                                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path fill="currentColor" d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" /></svg>
                                下载文件
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Overlay preview for folder share files */}
            {previewFile && (
                <div className="preview-overlay" onClick={() => { if (shareInfo?.isDir) { setPreviewFile(null); setIsPreviewFullscreen(false); } }}>
                    <div className={`preview-container ${isPreviewFullscreen ? 'fullscreen' : ''}`} onClick={(e) => e.stopPropagation()}>
                        <div className="preview-header">
                            <h3>{previewFile.file.name}</h3>
                            <div className="preview-header-actions">
                                <button className="share-action-btn" onClick={() => handleDownload(previewFile.file)} title="下载">
                                    <svg viewBox="0 0 24 24" width="16" height="16"><path fill="#aaa" d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" /></svg>
                                </button>
                                <button className="share-action-btn" onClick={() => setIsPreviewFullscreen(prev => !prev)} title={isPreviewFullscreen ? '退出全屏' : '全屏'}>
                                    {isPreviewFullscreen ? (
                                        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="#aaa" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" /></svg>
                                    ) : (
                                        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="#aaa" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
                                    )}
                                </button>
                                {shareInfo?.isDir && (
                                    <button className="share-action-btn" onClick={() => { setPreviewFile(null); setIsPreviewFullscreen(false); }} title="关闭">
                                        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="#aaa" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="preview-body">
                            {previewLoading && (
                                <div className="share-page-loading"><div className="preparing-spinner"></div></div>
                            )}
                            {previewFile.type === 'image' && previewFile.content && (
                                <img src={previewFile.content} alt={previewFile.file.name} style={{ maxWidth: '100%', maxHeight: '80vh' }} />
                            )}
                            {previewFile.type === 'video' && previewFile.content && (
                                <video src={previewFile.content} controls style={{ maxWidth: '100%', maxHeight: '80vh' }} />
                            )}
                            {previewFile.type === 'audio' && previewFile.content && (
                                <audio src={previewFile.content} controls />
                            )}
                            {previewFile.type === 'markdown' && previewFile.content && (
                                <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: marked(previewFile.content) as string }} />
                            )}
                            {previewFile.type === 'html' && previewFile.content && (
                                <div className="html-preview-stage">
                                    <div className="html-preview-wrapper">
                                        <iframe srcDoc={previewFile.content} className="html-preview" sandbox="allow-scripts allow-forms allow-popups allow-modals" />
                                    </div>
                                </div>
                            )}
                            {previewFile.type === 'code' && previewFile.content && (
                                <pre className="code-preview">
                                    <code
                                        className={`hljs language-${getLanguage(previewFile.file.name)}`}
                                        dangerouslySetInnerHTML={{ __html: highlightCode(previewFile.content, getLanguage(previewFile.file.name)) }}
                                    />
                                </pre>
                            )}
                            {previewFile.type === 'csv' && previewFile.content && (
                                <div className="table-preview-container">
                                    <div className="csv-preview" dangerouslySetInnerHTML={{ __html: renderCsvTable(previewFile.content) }} />
                                </div>
                            )}
                            {previewFile.type === 'xlsx' && previewFile.content && (
                                <div className="table-preview-container">
                                    <div className="xlsx-preview" dangerouslySetInnerHTML={{ __html: previewFile.content }} />
                                </div>
                            )}
                            {previewFile.type === 'docx' && previewFile.content && (
                                <div className="docx-preview" dangerouslySetInnerHTML={{ __html: previewFile.content }} />
                            )}
                            {previewFile.type === 'pdf' && previewFile.content && (
                                <iframe src={previewFile.content} style={{ width: '100%', height: '80vh', border: 'none', background: '#fff', borderRadius: '4px' }} />
                            )}
                            {previewFile.type === 'unsupported' && (
                                <div className="share-unsupported-preview">
                                    <svg viewBox="0 0 24 24" width="48" height="48"><path fill="#666" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" /></svg>
                                    <p>此文件类型暂不支持预览</p>
                                    <button className="share-download-btn" onClick={() => handleDownload(previewFile.file)}>
                                        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path fill="currentColor" d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" /></svg>
                                        下载文件
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

};
