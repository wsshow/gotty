package server

import (
	"io"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pkg/errors"
)

type wsWrapper struct {
	*websocket.Conn
	writeMu sync.Mutex
}

func (wsw *wsWrapper) Write(p []byte) (n int, err error) {
	wsw.writeMu.Lock()
	defer wsw.writeMu.Unlock()
	wsw.Conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
	writer, err := wsw.Conn.NextWriter(websocket.TextMessage)
	if err != nil {
		return 0, err
	}
	defer writer.Close()
	return writer.Write(p)
}

func (wsw *wsWrapper) WritePing() error {
	wsw.writeMu.Lock()
	defer wsw.writeMu.Unlock()
	wsw.Conn.SetWriteDeadline(time.Now().Add(wsPingTimeout))
	return wsw.Conn.WriteMessage(websocket.PingMessage, nil)
}

func (wsw *wsWrapper) Read(p []byte) (n int, err error) {
	for {
		msgType, reader, err := wsw.Conn.NextReader()
		if err != nil {
			return 0, err
		}

		if msgType != websocket.TextMessage {
			continue
		}

		b, err := io.ReadAll(reader)
		if len(b) > len(p) {
			return 0, errors.Wrapf(err, "Client message exceeded buffer size")
		}
		n = copy(p, b)
		return n, err
	}
}
