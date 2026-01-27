package server

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

// handleAuthVerify handles authentication verification
func (server *Server) handleAuthVerify(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := strings.SplitN(r.Header.Get("Authorization"), " ", 2)

	if len(token) != 2 || strings.ToLower(token[0]) != "basic" {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Invalid authorization header",
		})
		return
	}

	payload, err := base64.StdEncoding.DecodeString(token[1])
	if err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Invalid credentials",
		})
		return
	}

	if server.options.Credential != string(payload) {
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Authentication failed",
		})
		return
	}

	log.Printf("Authentication succeeded: %s", r.RemoteAddr)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Authentication successful",
	})
}
