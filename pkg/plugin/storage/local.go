package storage

import (
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
)

const (
	approvedDirName = "approved"
	pendingDirName  = "pending"
)

// LocalStorage implements Storage using the local filesystem.
type LocalStorage struct {
	rootDir string
}

// NewLocalStorage creates a new LocalStorage rooted at rootDir.
// It creates the directory if it does not exist and migrates legacy templates
// into the approved queue.
func NewLocalStorage(rootDir string) (*LocalStorage, error) {
	if err := os.MkdirAll(rootDir, 0755); err != nil {
		return nil, fmt.Errorf("creating storage root %q: %w", rootDir, err)
	}

	store := &LocalStorage{rootDir: rootDir}
	if err := store.ensureQueueDirs(); err != nil {
		return nil, err
	}
	if err := store.migrateLegacyTemplates(); err != nil {
		return nil, err
	}

	return store, nil
}

func (s *LocalStorage) ensureQueueDirs() error {
	for _, dir := range []string{s.queueDir(TemplateStateApproved), s.queueDir(TemplateStatePending)} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("creating template queue %q: %w", dir, err)
		}
	}

	return nil
}

func (s *LocalStorage) migrateLegacyTemplates() error {
	entries, err := os.ReadDir(s.rootDir)
	if err != nil {
		return fmt.Errorf("reading storage root: %w", err)
	}

	approvedDir := s.queueDir(TemplateStateApproved)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		name := entry.Name()
		if name == approvedDirName || name == pendingDirName {
			continue
		}

		source := filepath.Join(s.rootDir, name)
		target := filepath.Join(approvedDir, name)
		if _, err := os.Stat(target); err == nil {
			continue
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("checking migrated template %q: %w", name, err)
		}

		if err := os.Rename(source, target); err != nil {
			return fmt.Errorf("moving legacy template %q into approved queue: %w", name, err)
		}
	}

	return nil
}

func (s *LocalStorage) queueDir(state TemplateState) string {
	switch NormalizeTemplateState(state) {
	case TemplateStatePending:
		return filepath.Join(s.rootDir, pendingDirName)
	default:
		return filepath.Join(s.rootDir, approvedDirName)
	}
}

// templateDir returns the absolute path to a template's directory for the given state.
func (s *LocalStorage) templateDir(id string, state TemplateState) string {
	return filepath.Join(s.queueDir(state), filepath.Clean("/"+id)[1:])
}

// ListTemplates reads metadata.json for every sub-directory in the selected queue.
func (s *LocalStorage) ListTemplates(state TemplateState) ([][]byte, error) {
	queueDir := s.queueDir(state)
	entries, err := os.ReadDir(queueDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading storage queue %q: %w", queueDir, err)
	}

	var results [][]byte
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		metaPath := filepath.Join(queueDir, entry.Name(), "metadata.json")
		data, err := os.ReadFile(metaPath)
		if err != nil {
			continue
		}
		results = append(results, data)
	}
	return results, nil
}

// GetMetadata returns the contents of <state>/<id>/metadata.json.
func (s *LocalStorage) GetMetadata(id string, state TemplateState) ([]byte, error) {
	return s.readFile(id, state, "metadata.json")
}

// GetTemplate returns the contents of <state>/<id>/template.json.
func (s *LocalStorage) GetTemplate(id string, state TemplateState) ([]byte, error) {
	return s.readFile(id, state, "template.json")
}

// GetVariables returns the contents of <state>/<id>/variables.json.
func (s *LocalStorage) GetVariables(id string, state TemplateState) ([]byte, error) {
	return s.readFile(id, state, "variables.json")
}

// GetImage returns the image bytes for a template.
// It tries common image extensions in order.
func (s *LocalStorage) GetImage(id string, state TemplateState) ([]byte, string, error) {
	dir := s.templateDir(id, state)
	candidates := []struct {
		name string
		mime string
	}{
		{"image.png", "image/png"},
		{"image.jpg", "image/jpeg"},
		{"image.jpeg", "image/jpeg"},
		{"image.gif", "image/gif"},
		{"image.webp", "image/webp"},
	}
	for _, c := range candidates {
		path := filepath.Join(dir, c.name)
		data, err := os.ReadFile(path)
		if err == nil {
			return data, c.mime, nil
		}
	}
	return nil, "", fmt.Errorf("%w: no image found for template %q", ErrTemplateNotFound, id)
}

// TemplateExists checks whether the template exists in either queue.
func (s *LocalStorage) TemplateExists(id string) (bool, error) {
	for _, state := range []TemplateState{TemplateStateApproved, TemplateStatePending} {
		_, err := os.Stat(s.templateDir(id, state))
		if err == nil {
			return true, nil
		}
		if err != nil && !os.IsNotExist(err) {
			return false, fmt.Errorf("checking template %q existence: %w", id, err)
		}
	}

	return false, nil
}

// SaveTemplate writes all template files into the selected queue.
func (s *LocalStorage) SaveTemplate(
	id string,
	state TemplateState,
	templateJSON, metadataJSON, variablesJSON []byte,
	image io.Reader,
	imageMime string,
) error {
	dir := s.templateDir(id, state)

	exists, err := s.TemplateExists(id)
	if err != nil {
		return err
	}
	if exists {
		return fmt.Errorf("%w: %s", ErrTemplateAlreadyExists, id)
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("creating template dir: %w", err)
	}

	if err := os.WriteFile(filepath.Join(dir, "template.json"), templateJSON, 0644); err != nil {
		return fmt.Errorf("writing template.json: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "metadata.json"), metadataJSON, 0644); err != nil {
		return fmt.Errorf("writing metadata.json: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "variables.json"), variablesJSON, 0644); err != nil {
		return fmt.Errorf("writing variables.json: %w", err)
	}

	if image != nil {
		ext := ".png"
		if imageMime != "" {
			exts, err := mime.ExtensionsByType(imageMime)
			if err == nil && len(exts) > 0 {
				ext = exts[0]
			}
		}
		imgPath := filepath.Join(dir, "image"+ext)
		f, err := os.Create(imgPath)
		if err != nil {
			return fmt.Errorf("creating image file: %w", err)
		}
		defer f.Close()
		if _, err := io.Copy(f, image); err != nil {
			return fmt.Errorf("writing image: %w", err)
		}
	}

	return nil
}

// ApproveTemplate moves a template from the pending queue into the approved queue.
func (s *LocalStorage) ApproveTemplate(id string, metadataJSON []byte) error {
	pendingDir := s.templateDir(id, TemplateStatePending)
	approvedDir := s.templateDir(id, TemplateStateApproved)

	if _, err := os.Stat(pendingDir); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("%w: %s", ErrTemplateNotFound, id)
		}
		return fmt.Errorf("checking pending template %q: %w", id, err)
	}

	if _, err := os.Stat(approvedDir); err == nil {
		return fmt.Errorf("%w: %s", ErrTemplateAlreadyExists, id)
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("checking approved template %q: %w", id, err)
	}

	if err := os.MkdirAll(filepath.Dir(approvedDir), 0755); err != nil {
		return fmt.Errorf("creating approved queue dir: %w", err)
	}

	if err := os.Rename(pendingDir, approvedDir); err != nil {
		return fmt.Errorf("moving template %q to approved queue: %w", id, err)
	}

	if err := os.WriteFile(filepath.Join(approvedDir, "metadata.json"), metadataJSON, 0644); err != nil {
		return fmt.Errorf("updating approved metadata: %w", err)
	}

	return nil
}

// DeleteTemplate removes the template directory and all its contents.
func (s *LocalStorage) DeleteTemplate(id string, state TemplateState) error {
	dir := s.templateDir(id, state)
	if _, err := os.Stat(dir); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("%w: %s", ErrTemplateNotFound, id)
		}
		return fmt.Errorf("checking template %q before delete: %w", id, err)
	}

	return os.RemoveAll(dir)
}

// Ping succeeds when the storage root and both queues are accessible.
func (s *LocalStorage) Ping() error {
	if _, err := os.Stat(s.rootDir); err != nil {
		return fmt.Errorf("storage root not accessible: %w", err)
	}

	return s.ensureQueueDirs()
}

// readFile is a helper that reads a named file from a template's directory.
func (s *LocalStorage) readFile(id string, state TemplateState, name string) ([]byte, error) {
	path := filepath.Join(s.templateDir(id, state), name)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("%w: template %q not found", ErrTemplateNotFound, id)
		}
		return nil, fmt.Errorf("reading %s for %q: %w", name, id, err)
	}
	return data, nil
}
