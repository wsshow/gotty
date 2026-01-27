package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"

	"github.com/gorilla/websocket"
	"github.com/pkg/errors"

	"gotty/webtty"
)

func (server *Server) generateHandleWS(ctx context.Context, cancel context.CancelFunc, counter *counter) http.HandlerFunc {
	once := new(int64)

	go func() {
		select {
		case <-counter.timer().C:
			cancel()
		case <-ctx.Done():
		}
	}()

	return func(w http.ResponseWriter, r *http.Request) {
		if server.options.Once {
			success := atomic.CompareAndSwapInt64(once, 0, 1)
			if !success {
				http.Error(w, "Server is shutting down", http.StatusServiceUnavailable)
				return
			}
		}

		num := counter.add(1)
		closeReason := "unknown reason"

		defer func() {
			num := counter.done()
			log.Printf(
				"Connection closed by %s: %s, connections: %d/%d",
				closeReason, r.RemoteAddr, num, server.options.MaxConnection,
			)

			if server.options.Once {
				cancel()
			}
		}()

		if int64(server.options.MaxConnection) != 0 {
			if num > server.options.MaxConnection {
				closeReason = "exceeding max number of connections"
				return
			}
		}

		log.Printf("New client connected: %s, connections: %d/%d", r.RemoteAddr, num, server.options.MaxConnection)

		if r.Method != "GET" {
			http.Error(w, "Method not allowed", 405)
			return
		}

		// Verify authentication if BasicAuth is enabled
		if server.options.EnableBasicAuth {
			// Try to get auth from query parameter first (for WebSocket)
			authToken := r.URL.Query().Get("auth")
			if authToken != "" {
				// Decode the base64 auth token
				payload, err := base64.StdEncoding.DecodeString(authToken)
				if err != nil {
					log.Printf("[GoTTY] Failed to decode auth token: %v", err)
					http.Error(w, "Unauthorized", http.StatusUnauthorized)
					return
				}
				if server.options.Credential != string(payload) {
					log.Printf("[GoTTY] Invalid credentials from query: got '%s', expected '%s'", string(payload), server.options.Credential)
					http.Error(w, "Unauthorized", http.StatusUnauthorized)
					return
				}
				log.Printf("[GoTTY] WebSocket auth successful via query parameter")
			} else {
				// Fall back to Authorization header
				token := strings.SplitN(r.Header.Get("Authorization"), " ", 2)
				if len(token) != 2 || strings.ToLower(token[0]) != "basic" {
					log.Printf("[GoTTY] Invalid Authorization header format")
					http.Error(w, "Unauthorized", http.StatusUnauthorized)
					return
				}
				payload, err := base64.StdEncoding.DecodeString(token[1])
				if err != nil {
					log.Printf("[GoTTY] Failed to decode Authorization header: %v", err)
					http.Error(w, "Unauthorized", http.StatusUnauthorized)
					return
				}
				if server.options.Credential != string(payload) {
					log.Printf("[GoTTY] Invalid credentials from header: got '%s', expected '%s'", string(payload), server.options.Credential)
					http.Error(w, "Unauthorized", http.StatusUnauthorized)
					return
				}
				log.Printf("[GoTTY] WebSocket auth successful via Authorization header")
			}
		}

		conn, err := server.upgrader.Upgrade(w, r, nil)
		if err != nil {
			closeReason = err.Error()
			return
		}
		defer conn.Close()

		if server.options.PassHeaders {
			err = server.processWSConn(ctx, conn, r.Header)
		} else {
			err = server.processWSConn(ctx, conn, nil)
		}

		switch err {
		case ctx.Err():
			closeReason = "cancelation"
		case webtty.ErrSlaveClosed:
			closeReason = server.factory.Name()
		case webtty.ErrMasterClosed:
			closeReason = "client"
		default:
			closeReason = fmt.Sprintf("an error: %s", err)
		}
	}
}

func (server *Server) processWSConn(ctx context.Context, conn *websocket.Conn, headers map[string][]string) error {
	typ, initLine, err := conn.ReadMessage()
	if err != nil {
		return errors.Wrapf(err, "failed to authenticate websocket connection")
	}
	if typ != websocket.TextMessage {
		return errors.New("failed to authenticate websocket connection: invalid message type")
	}

	var init InitMessage
	err = json.Unmarshal(initLine, &init)
	if err != nil {
		return errors.Wrapf(err, "failed to authenticate websocket connection")
	}

	// Decode base64 auth token and compare with credential
	decodedAuth, err := base64.StdEncoding.DecodeString(init.AuthToken)
	if err != nil || string(decodedAuth) != server.options.Credential {
		log.Printf("[GoTTY] WebSocket init auth failed: decoded='%s', expected='%s', decode_err=%v", string(decodedAuth), server.options.Credential, err)
		return errors.New("failed to authenticate websocket connection")
	}
	log.Printf("[GoTTY] WebSocket initialization authenticated successfully")

	queryPath := "?"
	if server.options.PermitArguments && init.Arguments != "" {
		queryPath = init.Arguments
	}

	query, err := url.Parse(queryPath)
	if err != nil {
		return errors.Wrapf(err, "failed to parse arguments")
	}
	params := query.Query()
	var slave Slave
	slave, err = server.factory.New(params, headers)
	if err != nil {
		return errors.Wrapf(err, "failed to create backend")
	}
	defer slave.Close()

	titleVars := server.titleVariables(
		[]string{"server", "master", "slave"},
		map[string]map[string]any{
			"server": server.options.TitleVariables,
			"master": {
				"remote_addr": conn.RemoteAddr(),
			},
			"slave": slave.WindowTitleVariables(),
		},
	)

	titleBuf := new(bytes.Buffer)
	err = server.titleTemplate.Execute(titleBuf, titleVars)
	if err != nil {
		return errors.Wrapf(err, "failed to fill window title template")
	}

	opts := []webtty.Option{
		webtty.WithWindowTitle(titleBuf.Bytes()),
	}
	if server.options.PermitWrite {
		opts = append(opts, webtty.WithPermitWrite())
	}
	if server.options.EnableReconnect {
		opts = append(opts, webtty.WithReconnect(server.options.ReconnectTime))
	}
	if server.options.Width > 0 {
		opts = append(opts, webtty.WithFixedColumns(server.options.Width))
	}
	if server.options.Height > 0 {
		opts = append(opts, webtty.WithFixedRows(server.options.Height))
	}
	tty, err := webtty.New(&wsWrapper{conn}, slave, opts...)
	if err != nil {
		return errors.Wrapf(err, "failed to create webtty")
	}

	err = tty.Run(ctx)

	return err
}

func (server *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	indexVars, err := server.indexVariables(r)
	if err != nil {
		http.Error(w, "Internal Server Error", 500)
		return
	}

	indexBuf := new(bytes.Buffer)
	err = server.indexTemplate.Execute(indexBuf, indexVars)
	if err != nil {
		http.Error(w, "Internal Server Error", 500)
		return
	}

	w.Write(indexBuf.Bytes())
}

func (server *Server) handleManifest(w http.ResponseWriter, r *http.Request) {
	indexVars, err := server.indexVariables(r)
	if err != nil {
		http.Error(w, "Internal Server Error", 500)
		return
	}

	indexBuf := new(bytes.Buffer)
	err = server.manifestTemplate.Execute(indexBuf, indexVars)
	if err != nil {
		http.Error(w, "Internal Server Error", 500)
		return
	}

	w.Write(indexBuf.Bytes())
}

func (server *Server) indexVariables(r *http.Request) (map[string]interface{}, error) {
	titleVars := server.titleVariables(
		[]string{"server", "master"},
		map[string]map[string]any{
			"server": server.options.TitleVariables,
			"master": {
				"remote_addr": r.RemoteAddr,
			},
		},
	)

	titleBuf := new(bytes.Buffer)
	err := server.titleTemplate.Execute(titleBuf, titleVars)
	if err != nil {
		return nil, err
	}

	indexVars := map[string]interface{}{
		"title": titleBuf.String(),
	}
	return indexVars, err
}

func (server *Server) handleAuthToken(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript")
	// @TODO hashing?
	w.Write([]byte("var gotty_auth_token = '" + server.options.Credential + "';"))
}

func (server *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript")
	lines := []string{
		"var gotty_term = 'xterm';",
		"var gotty_ws_query_args = '" + server.options.WSQueryArgs + "';",
	}

	if server.options.EnableBasicAuth {
		lines = append(lines, "var gotty_enable_auth = true;")
	} else {
		lines = append(lines, "var gotty_enable_auth = false;")
	}

	w.Write([]byte(strings.Join(lines, "\n")))
}

// titleVariables merges maps in a specified order.
// varUnits are name-keyed maps, whose names will be iterated using order.
func (server *Server) titleVariables(order []string, varUnits map[string]map[string]interface{}) map[string]interface{} {
	titleVars := map[string]interface{}{}

	for _, name := range order {
		vars, ok := varUnits[name]
		if !ok {
			panic("title variable name error")
		}
		for key, val := range vars {
			titleVars[key] = val
		}
	}

	// safe net for conflicted keys
	for _, name := range order {
		titleVars[name] = varUnits[name]
	}

	return titleVars
}
