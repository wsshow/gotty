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
                            {uploading ? '上传中...' : '选择文件上传'}
                        </label>
                        <button className="refresh-btn" onClick={loadFiles} disabled={loading}>
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
                                            <td className="filename">{file.name}</td>
                                            <td>{formatSize(file.size)}</td>
                                            <td>{formatDate(file.time)}</td>
                                            <td>
                                                <button
                                                    className="action-btn download-btn"
                                                    onClick={() => handleDownload(file.name)}
                                                >
                                                    下载
                                                </button>
                                                <button
                                                    className="action-btn delete-btn"
                                                    onClick={() => handleDelete(file.name)}
                                                >
                                                    删除
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
