package server

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	maxUploadSize  = 100 * 1024 * 1024 // 100 MB
	chunkSize      = 5 * 1024 * 1024   // 5 MB per chunk
	uploadPath     = "./uploads"
	tempUploadPath = "./uploads/.temp"
)

// handleFileUpload handles file upload requests (supports batch and folder uploads)
func (server *Server) handleFileUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse multipart form
	err := r.ParseMultipartForm(maxUploadSize)
	if err != nil {
		http.Error(w, fmt.Sprintf("Could not parse multipart form: %v", err), http.StatusBadRequest)
		return
	}

	// Get upload path from form
	targetPath := r.FormValue("path")
	if targetPath == "" {
		targetPath = "."
	}

	// Sanitize path
	targetPath = filepath.Clean(targetPath)
	if strings.HasPrefix(targetPath, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	fullTargetPath := filepath.Join(uploadPath, targetPath)

	// Create upload directory if it doesn't exist
	if err := os.MkdirAll(fullTargetPath, 0755); err != nil {
		http.Error(w, fmt.Sprintf("Could not create upload directory: %v", err), http.StatusInternalServerError)
		return
	}

	// Handle multiple files
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		http.Error(w, "No files provided", http.StatusBadRequest)
		return
	}

	type UploadResult struct {
		Filename string `json:"filename"`
		Size     int64  `json:"size"`
		Path     string `json:"path"`
	}

	results := []UploadResult{}

	for _, handler := range files {
		file, err := handler.Open()
		if err != nil {
			log.Printf("Error opening file %s: %v", handler.Filename, err)
			continue
		}

		// Get relative path from form (for folder uploads)
		relativePath := handler.Filename

		// Clean and validate the path
		relativePath = filepath.Clean(relativePath)
		if strings.HasPrefix(relativePath, "..") {
			file.Close()
			continue
		}

		// Combine target path with relative path
		filePath := filepath.Join(fullTargetPath, relativePath)

		// Create parent directories if needed
		fileDir := filepath.Dir(filePath)
		if err := os.MkdirAll(fileDir, 0755); err != nil {
			log.Printf("Could not create directory for file %s: %v", relativePath, err)
			file.Close()
			continue
		}

		// Check if file exists and create a unique name if necessary
		if _, err := os.Stat(filePath); err == nil {
			ext := filepath.Ext(relativePath)
			name := strings.TrimSuffix(filepath.Base(relativePath), ext)
			dir := filepath.Dir(filePath)
			for i := 1; ; i++ {
				filePath = filepath.Join(dir, fmt.Sprintf("%s_%d%s", name, i, ext))
				if _, err := os.Stat(filePath); os.IsNotExist(err) {
					break
				}
			}
		}

		// Create the destination file
		dst, err := os.Create(filePath)
		if err != nil {
			log.Printf("Could not create file %s: %v", filePath, err)
			file.Close()
			continue
		}

		// Copy the uploaded file to the destination file
		size, err := io.Copy(dst, file)
		dst.Close()
		file.Close()

		if err != nil {
			log.Printf("Could not save file %s: %v", filePath, err)
			os.Remove(filePath)
			continue
		}

		// Get relative path from uploadPath
		relPath, _ := filepath.Rel(uploadPath, filePath)

		results = append(results, UploadResult{
			Filename: filepath.Base(filePath),
			Size:     size,
			Path:     relPath,
		})

		log.Printf("File uploaded successfully: %s (size: %d bytes)", filePath, size)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"files":   results,
		"count":   len(results),
	})
}

// handleChunkUpload handles chunked file upload requests
func (server *Server) handleChunkUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse multipart form
	err := r.ParseMultipartForm(chunkSize)
	if err != nil {
		http.Error(w, fmt.Sprintf("Could not parse multipart form: %v", err), http.StatusBadRequest)
		return
	}

	// Get chunk information
	chunkIndex := r.FormValue("chunkIndex")
	totalChunks := r.FormValue("totalChunks")
	fileId := r.FormValue("fileId")
	filename := r.FormValue("filename")
	targetPath := r.FormValue("path")

	if chunkIndex == "" || totalChunks == "" || fileId == "" || filename == "" {
		http.Error(w, "Missing required parameters", http.StatusBadRequest)
		return
	}

	if targetPath == "" {
		targetPath = "."
	}

	// Sanitize paths
	targetPath = filepath.Clean(targetPath)
	if strings.HasPrefix(targetPath, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	filename = filepath.Base(filename)

	// Create temp directory
	tempDir := filepath.Join(tempUploadPath, fileId)
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		http.Error(w, fmt.Sprintf("Could not create temp directory: %v", err), http.StatusInternalServerError)
		return
	}

	// Get the chunk file from the form
	file, _, err := r.FormFile("chunk")
	if err != nil {
		http.Error(w, fmt.Sprintf("Error retrieving chunk: %v", err), http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Save chunk to temp directory
	chunkPath := filepath.Join(tempDir, chunkIndex)
	dst, err := os.Create(chunkPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Could not create chunk file: %v", err), http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, fmt.Sprintf("Could not save chunk: %v", err), http.StatusInternalServerError)
		return
	}

	// Parse chunk numbers
	currentChunk, _ := strconv.Atoi(chunkIndex)
	total, _ := strconv.Atoi(totalChunks)

	w.Header().Set("Content-Type", "application/json")

	// Check if all chunks are uploaded
	if currentChunk == total-1 {
		// Merge chunks
		fullTargetPath := filepath.Join(uploadPath, targetPath)
		if err := os.MkdirAll(fullTargetPath, 0755); err != nil {
			http.Error(w, fmt.Sprintf("Could not create target directory: %v", err), http.StatusInternalServerError)
			return
		}

		finalPath := filepath.Join(fullTargetPath, filename)

		// Check if file exists and create unique name
		if _, err := os.Stat(finalPath); err == nil {
			ext := filepath.Ext(filename)
			name := strings.TrimSuffix(filename, ext)
			for i := 1; ; i++ {
				finalPath = filepath.Join(fullTargetPath, fmt.Sprintf("%s_%d%s", name, i, ext))
				if _, err := os.Stat(finalPath); os.IsNotExist(err) {
					break
				}
			}
		}

		finalFile, err := os.Create(finalPath)
		if err != nil {
			http.Error(w, fmt.Sprintf("Could not create final file: %v", err), http.StatusInternalServerError)
			return
		}
		defer finalFile.Close()

		// Merge all chunks in order
		var totalSize int64
		for i := 0; i < total; i++ {
			chunkPath := filepath.Join(tempDir, strconv.Itoa(i))
			chunkFile, err := os.Open(chunkPath)
			if err != nil {
				http.Error(w, fmt.Sprintf("Could not open chunk %d: %v", i, err), http.StatusInternalServerError)
				return
			}

			size, err := io.Copy(finalFile, chunkFile)
			chunkFile.Close()
			if err != nil {
				http.Error(w, fmt.Sprintf("Could not merge chunk %d: %v", i, err), http.StatusInternalServerError)
				return
			}
			totalSize += size
		}

		// Clean up temp directory
		os.RemoveAll(tempDir)

		log.Printf("File uploaded successfully (chunked): %s (size: %d bytes)", finalPath, totalSize)

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":  true,
			"complete": true,
			"filename": filepath.Base(finalPath),
			"size":     totalSize,
		})
	} else {
		// More chunks to come
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":  true,
			"complete": false,
			"chunk":    currentChunk,
		})
	}
}

// handleFileDownload handles file download requests with range support
func (server *Server) handleFileDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get filename from query parameter
	filename := r.URL.Query().Get("file")
	if filename == "" {
		http.Error(w, "Filename is required", http.StatusBadRequest)
		return
	}

	// Sanitize filename to prevent directory traversal attacks
	filename = filepath.Clean(filename)
	if strings.HasPrefix(filename, "..") {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join(uploadPath, filename)

	// Check if file exists
	fileInfo, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("Error accessing file: %v", err), http.StatusInternalServerError)
		return
	}

	// Open the file
	file, err := os.Open(filePath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Could not open file: %v", err), http.StatusInternalServerError)
		return
	}
	defer file.Close()

	// Detect content type
	contentType := mime.TypeByExtension(filepath.Ext(filename))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Check if it's a preview request
	isPreview := r.URL.Query().Get("preview") == "true"

	// Set headers
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size()))
	w.Header().Set("Accept-Ranges", "bytes")

	if !isPreview {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filepath.Base(filename)))
	}

	// Handle range requests for resumable downloads
	rangeHeader := r.Header.Get("Range")
	if rangeHeader != "" {
		// Parse range header
		ranges := strings.Split(strings.TrimPrefix(rangeHeader, "bytes="), "-")
		if len(ranges) == 2 {
			start, _ := strconv.ParseInt(ranges[0], 10, 64)
			end := fileInfo.Size() - 1
			if ranges[1] != "" {
				end, _ = strconv.ParseInt(ranges[1], 10, 64)
			}

			// Seek to start position
			file.Seek(start, 0)

			// Set partial content headers
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileInfo.Size()))
			w.Header().Set("Content-Length", fmt.Sprintf("%d", end-start+1))
			w.WriteHeader(http.StatusPartialContent)

			// Stream the requested range
			io.CopyN(w, file, end-start+1)
			log.Printf("File downloaded (range %d-%d): %s", start, end, filename)
			return
		}
	}

	// Stream the entire file
	if _, err := io.Copy(w, file); err != nil {
		log.Printf("Error streaming file: %v", err)
		return
	}

	log.Printf("File downloaded: %s (size: %d bytes)", filename, fileInfo.Size())
}

// handleBatchDownload handles batch download requests (creates a zip)
func (server *Server) handleBatchDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request struct {
		Files []string `json:"files"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(request.Files) == 0 {
		http.Error(w, "No files specified", http.StatusBadRequest)
		return
	}

	// Sanitize file paths
	var validFiles []string
	for _, file := range request.Files {
		cleanPath := filepath.Clean(file)
		if strings.HasPrefix(cleanPath, "..") {
			continue
		}
		validFiles = append(validFiles, cleanPath)
	}

	if len(validFiles) == 0 {
		http.Error(w, "No valid files to download", http.StatusBadRequest)
		return
	}

	// Set headers for zip download
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=\"files.zip\"")

	// Create zip writer
	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	// Add files to zip
	for _, file := range validFiles {
		fullPath := filepath.Join(uploadPath, file)

		// Check if path exists
		fileInfo, err := os.Stat(fullPath)
		if err != nil {
			log.Printf("Skipping file %s: %v", file, err)
			continue
		}

		if fileInfo.IsDir() {
			// Add directory recursively
			filepath.Walk(fullPath, func(path string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}

				// Get relative path
				relPath, err := filepath.Rel(uploadPath, path)
				if err != nil {
					return err
				}

				if info.IsDir() {
					// Create directory entry
					_, err := zipWriter.Create(relPath + "/")
					return err
				}

				// Add file to zip
				zipFile, err := zipWriter.Create(relPath)
				if err != nil {
					return err
				}

				srcFile, err := os.Open(path)
				if err != nil {
					return err
				}
				defer srcFile.Close()

				_, err = io.Copy(zipFile, srcFile)
				return err
			})
		} else {
			// Add single file to zip
			zipFile, err := zipWriter.Create(file)
			if err != nil {
				log.Printf("Error creating zip entry for %s: %v", file, err)
				continue
			}

			srcFile, err := os.Open(fullPath)
			if err != nil {
				log.Printf("Error opening file %s: %v", file, err)
				continue
			}

			io.Copy(zipFile, srcFile)
			srcFile.Close()
		}
	}

	log.Printf("Batch download completed: %d files", len(validFiles))
}

// handleFileList lists all available files and folders
func (server *Server) handleFileList(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get path from query parameter (relative to uploadPath)
	subPath := r.URL.Query().Get("path")
	if subPath == "" {
		subPath = "."
	}

	// Sanitize path to prevent directory traversal
	subPath = filepath.Clean(subPath)
	if strings.HasPrefix(subPath, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Create upload directory if it doesn't exist
	if err := os.MkdirAll(uploadPath, 0755); err != nil {
		http.Error(w, fmt.Sprintf("Could not access upload directory: %v", err), http.StatusInternalServerError)
		return
	}

	// Build full path
	fullPath := filepath.Join(uploadPath, subPath)

	// Check if path exists and is a directory
	fileInfo, err := os.Stat(fullPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Could not access path: %v", err), http.StatusInternalServerError)
		return
	}
	if !fileInfo.IsDir() {
		http.Error(w, "Path is not a directory", http.StatusBadRequest)
		return
	}

	// Read directory contents
	entries, err := os.ReadDir(fullPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Could not read directory: %v", err), http.StatusInternalServerError)
		return
	}

	// Build file list
	var files []map[string]interface{}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		fileEntry := map[string]interface{}{
			"name":  entry.Name(),
			"isDir": entry.IsDir(),
			"time":  info.ModTime().Unix(),
		}

		if !entry.IsDir() {
			fileEntry["size"] = info.Size()
		}

		files = append(files, fileEntry)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	// Simple JSON serialization
	fmt.Fprintf(w, `{"files": [`)
	for i, file := range files {
		if i > 0 {
			fmt.Fprintf(w, ",")
		}
		if file["isDir"].(bool) {
			fmt.Fprintf(w, `{"name": "%s", "isDir": true, "time": %d}`,
				file["name"], file["time"])
		} else {
			fmt.Fprintf(w, `{"name": "%s", "isDir": false, "size": %d, "time": %d}`,
				file["name"], file["size"], file["time"])
		}
	}
	fmt.Fprintf(w, `], "currentPath": "%s"}`, subPath)
}

// handleFileDelete handles file deletion requests
func (server *Server) handleFileDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != "DELETE" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get filename from query parameter
	filename := r.URL.Query().Get("file")
	if filename == "" {
		http.Error(w, "Filename is required", http.StatusBadRequest)
		return
	}

	// Sanitize filename to prevent directory traversal attacks
	filename = filepath.Clean(filename)
	if strings.HasPrefix(filename, "..") {
		http.Error(w, "Invalid filename", http.StatusBadRequest)
		return
	}

	filePath := filepath.Join(uploadPath, filename)

	// Check if file/folder exists
	fileInfo, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		http.Error(w, "File or folder not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("Could not access file: %v", err), http.StatusInternalServerError)
		return
	}

	// Delete the file or folder (recursively if it's a directory)
	if fileInfo.IsDir() {
		if err := os.RemoveAll(filePath); err != nil {
			http.Error(w, fmt.Sprintf("Could not delete folder: %v", err), http.StatusInternalServerError)
			return
		}
		log.Printf("Folder deleted: %s", filename)
	} else {
		if err := os.Remove(filePath); err != nil {
			http.Error(w, fmt.Sprintf("Could not delete file: %v", err), http.StatusInternalServerError)
			return
		}
		log.Printf("File deleted: %s", filename)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"success": true, "message": "File deleted successfully"}`)
}
