package server

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const (
	maxUploadSize = 100 * 1024 * 1024 // 100 MB
	uploadPath    = "./uploads"
)

// handleFileUpload handles file upload requests
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

	// Get the file from the form
	file, handler, err := r.FormFile("file")
	if err != nil {
		http.Error(w, fmt.Sprintf("Error retrieving file: %v", err), http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Create upload directory if it doesn't exist
	if err := os.MkdirAll(uploadPath, 0755); err != nil {
		http.Error(w, fmt.Sprintf("Could not create upload directory: %v", err), http.StatusInternalServerError)
		return
	}

	// Create a safe filename
	filename := filepath.Base(handler.Filename)
	filePath := filepath.Join(uploadPath, filename)

	// Check if file exists and create a unique name if necessary
	if _, err := os.Stat(filePath); err == nil {
		ext := filepath.Ext(filename)
		name := strings.TrimSuffix(filename, ext)
		for i := 1; ; i++ {
			filePath = filepath.Join(uploadPath, fmt.Sprintf("%s_%d%s", name, i, ext))
			if _, err := os.Stat(filePath); os.IsNotExist(err) {
				break
			}
		}
	}

	// Create the destination file
	dst, err := os.Create(filePath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Could not create file: %v", err), http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	// Copy the uploaded file to the destination file
	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, fmt.Sprintf("Could not save file: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("File uploaded successfully: %s (size: %d bytes)", filePath, handler.Size)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"success": true, "filename": "%s", "size": %d}`, filepath.Base(filePath), handler.Size)
}

// handleFileDownload handles file download requests
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

	// Sanitize filename to prevent directory traversal
	filename = filepath.Base(filename)
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

	// Set headers for file download
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size()))

	// Stream the file to the client
	if _, err := io.Copy(w, file); err != nil {
		log.Printf("Error streaming file: %v", err)
		return
	}

	log.Printf("File downloaded: %s (size: %d bytes)", filename, fileInfo.Size())
}

// handleFileList lists all available files
func (server *Server) handleFileList(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Create upload directory if it doesn't exist
	if err := os.MkdirAll(uploadPath, 0755); err != nil {
		http.Error(w, fmt.Sprintf("Could not access upload directory: %v", err), http.StatusInternalServerError)
		return
	}

	// Read directory contents
	entries, err := os.ReadDir(uploadPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Could not read directory: %v", err), http.StatusInternalServerError)
		return
	}

	// Build file list
	var files []map[string]interface{}
	for _, entry := range entries {
		if !entry.IsDir() {
			info, err := entry.Info()
			if err != nil {
				continue
			}
			files = append(files, map[string]interface{}{
				"name": entry.Name(),
				"size": info.Size(),
				"time": info.ModTime().Unix(),
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	// Simple JSON serialization
	fmt.Fprintf(w, `{"files": [`)
	for i, file := range files {
		if i > 0 {
			fmt.Fprintf(w, ",")
		}
		fmt.Fprintf(w, `{"name": "%s", "size": %d, "time": %d}`,
			file["name"], file["size"], file["time"])
	}
	fmt.Fprintf(w, `]}`)
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

	// Sanitize filename to prevent directory traversal
	filename = filepath.Base(filename)
	filePath := filepath.Join(uploadPath, filename)

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Delete the file
	if err := os.Remove(filePath); err != nil {
		http.Error(w, fmt.Sprintf("Could not delete file: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("File deleted: %s", filename)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, `{"success": true, "message": "File deleted successfully"}`)
}
