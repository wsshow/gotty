package server

import (
	"archive/zip"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	sharesFile = "./uploads/.shares.json"
)

type ShareInfo struct {
	Path      string `json:"path"`
	IsDir     bool   `json:"isDir"`
	Password  string `json:"password,omitempty"` // bcrypt hash
	ExpiresAt string `json:"expiresAt,omitempty"`
	CreatedAt string `json:"createdAt"`
}

type ShareStore struct {
	Shares map[string]*ShareInfo `json:"shares"`
	mu     sync.RWMutex
}

var shareStore *ShareStore

func initShareStore() {
	shareStore = &ShareStore{Shares: make(map[string]*ShareInfo)}
	data, err := os.ReadFile(sharesFile)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("Warning: failed to read shares file: %v", err)
		}
		return
	}
	if err := json.Unmarshal(data, shareStore); err != nil {
		log.Printf("Warning: failed to parse shares file: %v", err)
		shareStore.Shares = make(map[string]*ShareInfo)
	}
}

func (s *ShareStore) save() error {
	s.mu.RLock()
	data, err := json.MarshalIndent(s, "", "  ")
	s.mu.RUnlock()
	if err != nil {
		return err
	}
	dir := filepath.Dir(sharesFile)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	return os.WriteFile(sharesFile, data, 0600)
}

func generateToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *ShareStore) get(token string) (*ShareInfo, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	info, ok := s.Shares[token]
	if !ok {
		return nil, false
	}
	// Check expiration
	if info.ExpiresAt != "" {
		expiresAt, err := time.Parse(time.RFC3339, info.ExpiresAt)
		if err == nil && time.Now().After(expiresAt) {
			return nil, false
		}
	}
	return info, true
}

func (s *ShareStore) validatePassword(info *ShareInfo, password string) bool {
	if info.Password == "" {
		return true
	}
	return bcrypt.CompareHashAndPassword([]byte(info.Password), []byte(password)) == nil
}

// handleCreateShare creates a new share link (requires auth)
func (server *Server) handleCreateShare(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Path           string `json:"path"`
		Password       string `json:"password,omitempty"`
		ExpiresInHours int    `json:"expiresInHours,omitempty"` // 0 = no expiry
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Sanitize path
	cleanPath := filepath.Clean(req.Path)
	if strings.HasPrefix(cleanPath, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Verify path exists
	fullPath := filepath.Join(uploadPath, cleanPath)
	fi, err := os.Stat(fullPath)
	if err != nil {
		http.Error(w, "Path not found", http.StatusNotFound)
		return
	}

	token := generateToken()
	info := &ShareInfo{
		Path:      cleanPath,
		IsDir:     fi.IsDir(),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	if req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			http.Error(w, "Failed to process password", http.StatusInternalServerError)
			return
		}
		info.Password = string(hash)
	}

	if req.ExpiresInHours > 0 {
		info.ExpiresAt = time.Now().Add(time.Duration(req.ExpiresInHours) * time.Hour).UTC().Format(time.RFC3339)
	}

	shareStore.mu.Lock()
	shareStore.Shares[token] = info
	shareStore.mu.Unlock()

	if err := shareStore.save(); err != nil {
		log.Printf("Warning: failed to save shares: %v", err)
	}

	log.Printf("Share created: token=%s, path=%s, isDir=%v", token, cleanPath, fi.IsDir())

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"token":   token,
	})
}

// handleDeleteShare deletes a share link (requires auth)
func (server *Server) handleDeleteShare(w http.ResponseWriter, r *http.Request) {
	if r.Method != "DELETE" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "Token is required", http.StatusBadRequest)
		return
	}

	shareStore.mu.Lock()
	_, existed := shareStore.Shares[token]
	delete(shareStore.Shares, token)
	shareStore.mu.Unlock()

	if !existed {
		http.Error(w, "Share not found", http.StatusNotFound)
		return
	}

	if err := shareStore.save(); err != nil {
		log.Printf("Warning: failed to save shares: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

// handleListShares lists all shares (requires auth)
func (server *Server) handleListShares(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	shareStore.mu.RLock()
	result := make([]map[string]interface{}, 0, len(shareStore.Shares))
	for token, info := range shareStore.Shares {
		// Check expiration
		expired := false
		if info.ExpiresAt != "" {
			expiresAt, err := time.Parse(time.RFC3339, info.ExpiresAt)
			if err == nil && time.Now().After(expiresAt) {
				expired = true
			}
		}
		entry := map[string]interface{}{
			"token":       token,
			"path":        info.Path,
			"isDir":       info.IsDir,
			"hasPassword": info.Password != "",
			"expiresAt":   info.ExpiresAt,
			"createdAt":   info.CreatedAt,
			"expired":     expired,
		}
		result = append(result, entry)
	}
	shareStore.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"shares":  result,
	})
}

// --- Public share access endpoints (no auth required) ---

func getShareAndValidate(w http.ResponseWriter, r *http.Request) (*ShareInfo, bool) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "Token is required", http.StatusBadRequest)
		return nil, false
	}

	info, ok := shareStore.get(token)
	if !ok {
		http.Error(w, "Share not found or expired", http.StatusNotFound)
		return nil, false
	}

	// Check password
	if info.Password != "" {
		password := r.URL.Query().Get("password")
		if password == "" {
			password = r.Header.Get("X-Share-Password")
		}
		if !shareStore.validatePassword(info, password) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":            "Password required",
				"passwordRequired": true,
			})
			return nil, false
		}
	}

	return info, true
}

// handleShareInfo returns info about a share (public)
func (server *Server) handleShareInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "Token is required", http.StatusBadRequest)
		return
	}

	info, ok := shareStore.get(token)
	if !ok {
		http.Error(w, "Share not found or expired", http.StatusNotFound)
		return
	}

	// Return basic info without validating password first
	// The client needs to know if password is required
	result := map[string]interface{}{
		"path":        info.Path,
		"isDir":       info.IsDir,
		"hasPassword": info.Password != "",
		"expiresAt":   info.ExpiresAt,
		"name":        filepath.Base(info.Path),
	}

	// If password is set, check if caller provided correct one
	if info.Password != "" {
		password := r.URL.Query().Get("password")
		if password == "" {
			password = r.Header.Get("X-Share-Password")
		}
		result["authenticated"] = shareStore.validatePassword(info, password)
	} else {
		result["authenticated"] = true
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// handleShareFiles lists files in a shared folder (public)
func (server *Server) handleShareFiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	info, ok := getShareAndValidate(w, r)
	if !ok {
		return
	}

	if !info.IsDir {
		http.Error(w, "Not a directory share", http.StatusBadRequest)
		return
	}

	subPath := r.URL.Query().Get("path")
	if subPath == "" {
		subPath = "."
	}
	subPath = filepath.Clean(subPath)
	if strings.HasPrefix(subPath, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(uploadPath, info.Path, subPath)

	// Verify the resolved path is still under the shared directory
	sharedRoot := filepath.Join(uploadPath, info.Path)
	absFullPath, _ := filepath.Abs(fullPath)
	absSharedRoot, _ := filepath.Abs(sharedRoot)
	if !strings.HasPrefix(absFullPath, absSharedRoot) {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	fi, err := os.Stat(fullPath)
	if err != nil || !fi.IsDir() {
		http.Error(w, "Directory not found", http.StatusNotFound)
		return
	}

	entries, err := os.ReadDir(fullPath)
	if err != nil {
		http.Error(w, "Could not read directory", http.StatusInternalServerError)
		return
	}

	var files []map[string]interface{}
	for _, entry := range entries {
		entryInfo, err := entry.Info()
		if err != nil {
			continue
		}
		fileEntry := map[string]interface{}{
			"name":  entry.Name(),
			"isDir": entry.IsDir(),
			"time":  entryInfo.ModTime().Unix(),
		}
		if !entry.IsDir() {
			fileEntry["size"] = entryInfo.Size()
		}
		files = append(files, fileEntry)
	}

	sort.Slice(files, func(i, j int) bool {
		iIsDir := files[i]["isDir"].(bool)
		jIsDir := files[j]["isDir"].(bool)
		if iIsDir != jIsDir {
			return iIsDir
		}
		iTime := files[i]["time"].(int64)
		jTime := files[j]["time"].(int64)
		if iTime != jTime {
			return iTime > jTime
		}
		iName := files[i]["name"].(string)
		jName := files[j]["name"].(string)
		return iName < jName
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"files":       files,
		"currentPath": subPath,
	})
}

// handleShareDownload downloads a file from a share (public)
func (server *Server) handleShareDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	info, ok := getShareAndValidate(w, r)
	if !ok {
		return
	}

	var filePath string
	if info.IsDir {
		file := r.URL.Query().Get("file")
		if file == "" {
			http.Error(w, "File parameter is required for directory shares", http.StatusBadRequest)
			return
		}
		file = filepath.Clean(file)
		if strings.HasPrefix(file, "..") {
			http.Error(w, "Invalid file path", http.StatusBadRequest)
			return
		}
		filePath = filepath.Join(uploadPath, info.Path, file)

		// Verify path is under shared directory
		sharedRoot := filepath.Join(uploadPath, info.Path)
		absFilePath, _ := filepath.Abs(filePath)
		absSharedRoot, _ := filepath.Abs(sharedRoot)
		if !strings.HasPrefix(absFilePath, absSharedRoot) {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}
	} else {
		filePath = filepath.Join(uploadPath, info.Path)
	}

	fi, err := os.Stat(filePath)
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	if fi.IsDir() {
		http.Error(w, "Cannot download directory directly, use batch download", http.StatusBadRequest)
		return
	}

	file, err := os.Open(filePath)
	if err != nil {
		http.Error(w, "Could not open file", http.StatusInternalServerError)
		return
	}
	defer file.Close()

	contentType := mime.TypeByExtension(filepath.Ext(filePath))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	isPreview := r.URL.Query().Get("preview") == "true"

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", fi.Size()))
	w.Header().Set("Accept-Ranges", "bytes")

	if !isPreview {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filepath.Base(filePath)))
	}

	// Handle range requests
	rangeHeader := r.Header.Get("Range")
	if rangeHeader != "" {
		ranges := strings.Split(strings.TrimPrefix(rangeHeader, "bytes="), "-")
		if len(ranges) == 2 {
			start, _ := strconv.ParseInt(ranges[0], 10, 64)
			end := fi.Size() - 1
			if ranges[1] != "" {
				end, _ = strconv.ParseInt(ranges[1], 10, 64)
			}
			file.Seek(start, 0)
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fi.Size()))
			w.Header().Set("Content-Length", fmt.Sprintf("%d", end-start+1))
			w.WriteHeader(http.StatusPartialContent)
			io.CopyN(w, file, end-start+1)
			return
		}
	}

	io.Copy(w, file)
}

// handleShareBatchDownload downloads multiple files as zip from a share (public)
func (server *Server) handleShareBatchDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse token and password from query params for validation
	info, ok := getShareAndValidate(w, r)
	if !ok {
		return
	}

	if !info.IsDir {
		http.Error(w, "Batch download only for directory shares", http.StatusBadRequest)
		return
	}

	var req struct {
		Files []string `json:"files"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Files) == 0 {
		http.Error(w, "No files specified", http.StatusBadRequest)
		return
	}

	sharedRoot := filepath.Join(uploadPath, info.Path)
	absSharedRoot, _ := filepath.Abs(sharedRoot)

	var validFiles []string
	for _, f := range req.Files {
		cleanPath := filepath.Clean(f)
		if strings.HasPrefix(cleanPath, "..") {
			continue
		}
		fullPath := filepath.Join(sharedRoot, cleanPath)
		absPath, _ := filepath.Abs(fullPath)
		if !strings.HasPrefix(absPath, absSharedRoot) {
			continue
		}
		validFiles = append(validFiles, cleanPath)
	}

	if len(validFiles) == 0 {
		http.Error(w, "No valid files", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=\"shared_files.zip\"")

	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	for _, f := range validFiles {
		fullPath := filepath.Join(sharedRoot, f)
		fileInfo, err := os.Stat(fullPath)
		if err != nil {
			continue
		}

		if fileInfo.IsDir() {
			filepath.Walk(fullPath, func(path string, walkInfo os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				relPath, err := filepath.Rel(sharedRoot, path)
				if err != nil {
					return err
				}
				if walkInfo.IsDir() {
					zipWriter.Create(relPath + "/")
					return nil
				}
				zf, err := zipWriter.Create(relPath)
				if err != nil {
					return err
				}
				sf, err := os.Open(path)
				if err != nil {
					return err
				}
				defer sf.Close()
				io.Copy(zf, sf)
				return nil
			})
		} else {
			zf, err := zipWriter.Create(f)
			if err != nil {
				continue
			}
			sf, err := os.Open(fullPath)
			if err != nil {
				continue
			}
			io.Copy(zf, sf)
			sf.Close()
		}
	}
}
