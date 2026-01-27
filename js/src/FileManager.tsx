import { useState, useEffect } from 'preact/hooks';

interface FileInfo {
    name: string;
    size: number;
    time: number;
}

interface FileManagerProps {
    onClose: () => void;
}

export const FileManager = ({ onClose }: FileManagerProps) => {
    const [files, setFiles] = useState<FileInfo[]>([]);
    const [uploading, setUploading] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadFiles();
    }, []);

    const loadFiles = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('api/files');
            if (!response.ok) {
                throw new Error('Failed to load files');
            }
            const data = await response.json();
            setFiles(data.files || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load files');
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async (event: Event) => {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;

        setUploading(true);
        setError(null);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('api/upload', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            await loadFiles();
            target.value = ''; // Reset input
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const handleDownload = (filename: string) => {
        window.location.href = `api/download?file=${encodeURIComponent(filename)}`;
    };

    const handleDelete = async (filename: string) => {
        if (!confirm(`Are you sure you want to delete ${filename}?`)) {
            return;
        }

        setError(null);
        try {
            const response = await fetch(`api/delete?file=${encodeURIComponent(filename)}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                throw new Error('Delete failed');
            }

            await loadFiles();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Delete failed');
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

    return (
        <div className="file-manager-overlay" onClick={onClose}>
            <div className="file-manager" onClick={(e) => e.stopPropagation()}>
                <div className="file-manager-header">
                    <h2>文件管理器</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="file-manager-body">
                    <div className="upload-section">
                        <label className="upload-btn">
                            <input
                                type="file"
                                onChange={handleUpload}
                                disabled={uploading}
                                style={{ display: 'none' }}
                            />
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" />
                            </svg>
                            {uploading ? '上传中...' : '上传文件'}
                        </label>
                        <button className="refresh-btn" onClick={loadFiles} disabled={loading}>
                            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                            </svg>
                            {loading ? '加载中...' : '刷新'}
                        </button>
                    </div>

                    {error && (
                        <div className="error-message">
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
                                        <th>文件名</th>
                                        <th>大小</th>
                                        <th>上传时间</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {files.map((file) => (
                                        <tr key={file.name}>
                                            <td className="filename">
                                                <svg className="file-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                                                </svg>
                                                {file.name}
                                            </td>
                                            <td>{formatSize(file.size)}</td>
                                            <td>{formatDate(file.time)}</td>
                                            <td>
                                                <button
                                                    className="action-btn download-btn"
                                                    onClick={() => handleDownload(file.name)}
                                                    title="下载"
                                                >
                                                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                        <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z" />
                                                    </svg>
                                                </button>
                                                <button
                                                    className="action-btn delete-btn"
                                                    onClick={() => handleDelete(file.name)}
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
        </div>
    );
};
