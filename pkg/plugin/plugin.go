package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/greg00r/grafana-private-marketplace/pkg/plugin/storage"
)

// Ensure Plugin implements the required interfaces at compile time.
var (
	_ backend.CallResourceHandler   = (*Plugin)(nil)
	_ instancemgmt.InstanceDisposer = (*Plugin)(nil)
)

// Plugin is the App Plugin instance. One instance is created per Grafana org
// (or per plugin configuration, depending on Grafana version).
type Plugin struct {
	storage storage.Storage
	logger  log.Logger
}

// NewPlugin is the factory function called by app.Manage on startup.
func NewPlugin(_ context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	logger := log.DefaultLogger.With("plugin", "gregoor-private-marketplace-app")

	pluginSettings, secureSettings, err := parseSettings(settings)
	if err != nil {
		return nil, fmt.Errorf("parsing plugin settings: %w", err)
	}

	var store storage.Storage

	switch pluginSettings.StorageBackend {
	case "external":
		if pluginSettings.ExternalURL == "" {
			return nil, fmt.Errorf("externalUrl is required when storageBackend=external")
		}
		token := secureSettings.ExternalAuthToken
		if token == "" {
			token = secureSettings.ExternalAuthPassword
		}
		store = storage.NewExternalStorage(
			pluginSettings.ExternalURL,
			pluginSettings.ExternalAuthType,
			token,
			pluginSettings.ExternalAuthUser,
		)
		logger.Info("Using external storage", "url", pluginSettings.ExternalURL)

	default: // "local" or empty
		localPath := pluginSettings.LocalPath
		if localPath == "" {
			localPath = DefaultLocalPath
		}
		store, err = storage.NewLocalStorage(localPath)
		if err != nil {
			return nil, fmt.Errorf("initializing local storage: %w", err)
		}
		logger.Info("Using local storage", "path", localPath)
	}

	return &Plugin{
		storage: store,
		logger:  logger,
	}, nil
}

// CallResource handles all HTTP resource calls routed through /api/plugins/<id>/resources/*.
func (p *Plugin) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	// Convert the SDK request to a standard http.Request for use with our handler.
	httpReq, err := toHTTPRequest(req)
	if err != nil {
		return err
	}

	rw := &responseWriterBuffer{}
	p.handleResources(rw, httpReq)

	return sender.Send(&backend.CallResourceResponse{
		Status:  rw.status,
		Headers: rw.header,
		Body:    rw.body.Bytes(),
	})
}

// Dispose is called when the plugin instance is being shut down.
func (p *Plugin) Dispose() {}

// ── Settings parsing ─────────────────────────────────────────────────────────

func parseSettings(settings backend.AppInstanceSettings) (PluginSettings, PluginSecureSettings, error) {
	var ps PluginSettings
	var ss PluginSecureSettings

	if len(settings.JSONData) > 0 {
		if err := json.Unmarshal(settings.JSONData, &ps); err != nil {
			return ps, ss, fmt.Errorf("unmarshalling jsonData: %w", err)
		}
	}

	// Secure settings are passed as decrypted strings by the SDK.
	if v, ok := settings.DecryptedSecureJSONData["externalAuthToken"]; ok {
		ss.ExternalAuthToken = v
	}
	if v, ok := settings.DecryptedSecureJSONData["externalAuthPassword"]; ok {
		ss.ExternalAuthPassword = v
	}

	return ps, ss, nil
}

// ── HTTP adapter ─────────────────────────────────────────────────────────────

// toHTTPRequest converts a backend.CallResourceRequest to a standard *http.Request.
func toHTTPRequest(req *backend.CallResourceRequest) (*http.Request, error) {
	httpReq, err := http.NewRequest(req.Method, "/"+req.Path, bytes.NewReader(req.Body))
	if err != nil {
		return nil, fmt.Errorf("building http.Request: %w", err)
	}
	for k, vals := range req.Headers {
		for _, v := range vals {
			httpReq.Header.Add(k, v)
		}
	}
	// Attach URL query params from the original URL if present.
	if req.URL != "" {
		// req.URL may carry query params – parse and append them.
		if idx := indexOf(req.URL, '?'); idx >= 0 {
			httpReq.URL.RawQuery = req.URL[idx+1:]
		}
	}
	return httpReq, nil
}

func indexOf(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

// responseWriterBuffer is a minimal http.ResponseWriter that buffers the response.
type responseWriterBuffer struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (rw *responseWriterBuffer) Header() http.Header {
	if rw.header == nil {
		rw.header = make(http.Header)
	}
	return rw.header
}

func (rw *responseWriterBuffer) Write(b []byte) (int, error) {
	if rw.status == 0 {
		rw.status = http.StatusOK
	}
	return rw.body.Write(b)
}

func (rw *responseWriterBuffer) WriteHeader(status int) {
	rw.status = status
}

// Satisfy io.Writer for completeness (used by http.Error internally).
var _ io.Writer = (*responseWriterBuffer)(nil)
