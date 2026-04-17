package plugin

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Route patterns for resource dispatching.
var (
	reTemplatesList   = regexp.MustCompile(`^templates/?$`)
	reTemplateByID    = regexp.MustCompile(`^templates/([^/]+)/?$`)
	reTemplateImage   = regexp.MustCompile(`^templates/([^/]+)/image/?$`)
	reTemplateJSON    = regexp.MustCompile(`^templates/([^/]+)/template/?$`)
	reTemplateVars    = regexp.MustCompile(`^templates/([^/]+)/variables/?$`)
	reHealth          = regexp.MustCompile(`^health/?$`)
	reInitialize      = regexp.MustCompile(`^initialize/?$`)
)

// handleResources is the main router for plugin resource calls.
func (p *Plugin) handleResources(rw http.ResponseWriter, req *http.Request) {
	path := strings.TrimPrefix(req.URL.Path, "/")
	method := req.Method

	switch {
	case reHealth.MatchString(path) && method == http.MethodGet:
		p.handleHealth(rw, req)

	case reInitialize.MatchString(path) && method == http.MethodPost:
		p.handleInitialize(rw, req)

	case reTemplatesList.MatchString(path) && method == http.MethodGet:
		p.handleListTemplates(rw, req)

	case reTemplatesList.MatchString(path) && method == http.MethodPost:
		p.handleUploadTemplate(rw, req)

	case reTemplateImage.MatchString(path) && method == http.MethodGet:
		m := reTemplateImage.FindStringSubmatch(path)
		p.handleGetImage(rw, req, m[1])

	case reTemplateJSON.MatchString(path) && method == http.MethodGet:
		m := reTemplateJSON.FindStringSubmatch(path)
		p.handleGetTemplateJSON(rw, req, m[1])

	case reTemplateVars.MatchString(path) && method == http.MethodGet:
		m := reTemplateVars.FindStringSubmatch(path)
		p.handleGetVariables(rw, req, m[1])

	case reTemplateByID.MatchString(path) && method == http.MethodGet:
		m := reTemplateByID.FindStringSubmatch(path)
		p.handleGetMetadata(rw, req, m[1])

	case reTemplateByID.MatchString(path) && method == http.MethodDelete:
		m := reTemplateByID.FindStringSubmatch(path)
		p.handleDeleteTemplate(rw, req, m[1])

	default:
		http.Error(rw, "not found", http.StatusNotFound)
	}
}

// handleHealth returns 200 OK and pings the storage backend.
func (p *Plugin) handleHealth(rw http.ResponseWriter, _ *http.Request) {
	if err := p.storage.Ping(); err != nil {
		jsonError(rw, fmt.Sprintf("storage unhealthy: %v", err), http.StatusServiceUnavailable)
		return
	}
	jsonResponse(rw, map[string]string{"status": "ok"}, http.StatusOK)
}

// handleInitialize ensures the storage root exists (local only).
func (p *Plugin) handleInitialize(rw http.ResponseWriter, _ *http.Request) {
	// For local storage, NewLocalStorage already creates the directory.
	// Calling Ping verifies it's accessible.
	if err := p.storage.Ping(); err != nil {
		jsonError(rw, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(rw, map[string]string{"status": "initialized"}, http.StatusOK)
}

// handleListTemplates returns all templates as a JSON array.
func (p *Plugin) handleListTemplates(rw http.ResponseWriter, _ *http.Request) {
	metadataBlobs, err := p.storage.ListTemplates()
	if err != nil {
		jsonError(rw, err.Error(), http.StatusInternalServerError)
		return
	}

	templates := make([]Template, 0, len(metadataBlobs))
	for _, blob := range metadataBlobs {
		var meta TemplateMetadata
		if err := json.Unmarshal(blob, &meta); err != nil {
			continue // skip malformed entries
		}
		templates = append(templates, Template{
			Metadata: meta,
		})
	}

	jsonResponse(rw, templates, http.StatusOK)
}

// handleGetMetadata returns metadata.json for a single template.
func (p *Plugin) handleGetMetadata(rw http.ResponseWriter, _ *http.Request, id string) {
	data, err := p.storage.GetMetadata(id)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusNotFound)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write(data)
}

// handleGetTemplateJSON returns template.json (dashboard model).
func (p *Plugin) handleGetTemplateJSON(rw http.ResponseWriter, _ *http.Request, id string) {
	data, err := p.storage.GetTemplate(id)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusNotFound)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write(data)
}

// handleGetVariables returns variables.json for a template.
func (p *Plugin) handleGetVariables(rw http.ResponseWriter, _ *http.Request, id string) {
	data, err := p.storage.GetVariables(id)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusNotFound)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write(data)
}

// handleGetImage streams the template image.
func (p *Plugin) handleGetImage(rw http.ResponseWriter, _ *http.Request, id string) {
	data, mimeType, err := p.storage.GetImage(id)
	if err != nil {
		http.Error(rw, err.Error(), http.StatusNotFound)
		return
	}
	rw.Header().Set("Content-Type", mimeType)
	rw.Header().Set("Cache-Control", "public, max-age=86400")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write(data)
}

// handleUploadTemplate handles multipart/form-data POST for new templates.
func (p *Plugin) handleUploadTemplate(rw http.ResponseWriter, req *http.Request) {
	// Limit upload to 20 MB
	if err := req.ParseMultipartForm(20 << 20); err != nil {
		jsonError(rw, "parsing multipart form: "+err.Error(), http.StatusBadRequest)
		return
	}

	templateJSON := []byte(req.FormValue("templateJson"))
	metadataJSON := []byte(req.FormValue("metadata"))
	variablesJSON := []byte(req.FormValue("variablesJson"))

	if len(templateJSON) == 0 {
		jsonError(rw, "templateJson is required", http.StatusBadRequest)
		return
	}
	if len(metadataJSON) == 0 {
		jsonError(rw, "metadata is required", http.StatusBadRequest)
		return
	}

	// Parse and enrich metadata
	var meta TemplateMetadata
	if err := json.Unmarshal(metadataJSON, &meta); err != nil {
		jsonError(rw, "invalid metadata JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Generate ID from title if not provided
	if meta.ID == "" {
		meta.ID = slugify(meta.Title)
	}

	// Stamp timestamps
	now := time.Now().UTC().Format("2006-01-02")
	if meta.CreatedAt == "" {
		meta.CreatedAt = now
	}
	meta.UpdatedAt = now

	// Re-marshal enriched metadata
	enrichedMeta, err := json.Marshal(meta)
	if err != nil {
		jsonError(rw, "re-marshalling metadata: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Handle optional image
	var imageReader io.Reader
	var imageMime string
	imageFile, imageHeader, imgErr := req.FormFile("image")
	if imgErr == nil {
		defer imageFile.Close()
		imageReader = imageFile
		imageMime = imageHeader.Header.Get("Content-Type")
		if imageMime == "" {
			imageMime = "image/png"
		}
	}

	// Default empty variables.json
	if len(variablesJSON) == 0 {
		variablesJSON = []byte(`{"variables":[]}`)
	}

	if err := p.storage.SaveTemplate(
		meta.ID,
		templateJSON,
		enrichedMeta,
		variablesJSON,
		imageReader,
		imageMime,
	); err != nil {
		jsonError(rw, "saving template: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(rw, meta, http.StatusCreated)
}

// handleDeleteTemplate removes a template from storage.
func (p *Plugin) handleDeleteTemplate(rw http.ResponseWriter, _ *http.Request, id string) {
	if err := p.storage.DeleteTemplate(id); err != nil {
		jsonError(rw, err.Error(), http.StatusInternalServerError)
		return
	}
	rw.WriteHeader(http.StatusNoContent)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func jsonResponse(rw http.ResponseWriter, v interface{}, status int) {
	data, err := json.Marshal(v)
	if err != nil {
		http.Error(rw, "serialization error", http.StatusInternalServerError)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(status)
	_, _ = rw.Write(data)
}

func jsonError(rw http.ResponseWriter, message string, status int) {
	jsonResponse(rw, map[string]string{"error": message}, status)
}

var nonAlphanumRe = regexp.MustCompile(`[^a-z0-9]+`)

// slugify converts a title into a URL-safe lowercase slug.
func slugify(title string) string {
	s := strings.ToLower(title)
	s = nonAlphanumRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = fmt.Sprintf("template-%d", time.Now().UnixMilli())
	}
	return s
}

