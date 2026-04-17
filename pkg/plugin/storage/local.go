package storage

import (
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
)

// LocalStorage implements Storage using the local filesystem.
type LocalStorage struct {
	rootDir string
}

// NewLocalStorage creates a new LocalStorage rooted at rootDir.
// It creates the directory if it does not exist.
func NewLocalStorage(rootDir string) (*LocalStorage, error) {
	if err := os.MkdirAll(rootDir, 0755); err != nil {
		return nil, fmt.Errorf("creating storage root %q: %w", rootDir, err)
	}
	return &LocalStorage{rootDir: rootDir}, nil
}

// templateDir returns the absolute path to a template's directory.
func (s *LocalStorage) templateDir(id string) string {
	return filepath.Join(s.rootDir, filepath.Clean("/"+id)[1:]) // sanitize id
}

// ListTemplates reads metadata.json for every sub-directory in rootDir.
func (s *LocalStorage) ListTemplates() ([][]byte, error) {
	entries, err := os.ReadDir(s.rootDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading storage root: %w", err)
	}

	var results [][]byte
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		metaPath := filepath.Join(s.rootDir, entry.Name(), "metadata.json")
		data, err := os.ReadFile(metaPath)
		if err != nil {
			// Skip templates with missing metadata
			continue
		}
		results = append(results, data)
	}
	return results, nil
}

// GetMetadata returns the contents of <id>/metadata.json.
func (s *LocalStorage) GetMetadata(id string) ([]byte, error) {
	return s.readFile(id, "metadata.json")
}

// GetTemplate returns the contents of <id>/template.json.
func (s *LocalStorage) GetTemplate(id string) ([]byte, error) {
	return s.readFile(id, "template.json")
}

// GetVariables returns the contents of <id>/variables.json.
func (s *LocalStorage) GetVariables(id string) ([]byte, error) {
	return s.readFile(id, "variables.json")
}

// GetImage returns the image bytes for a template.
// It tries common image extensions in order.
func (s *LocalStorage) GetImage(id string) ([]byte, string, error) {
	dir := s.templateDir(id)
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
	return nil, "", fmt.Errorf("no image found for template %q", id)
}

// SaveTemplate writes all four template files atomically (best-effort).
func (s *LocalStorage) SaveTemplate(
	id string,
	templateJSON, metadataJSON, variablesJSON []byte,
	image io.Reader,
	imageMime string,
) error {
	dir := s.templateDir(id)
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
		ext := ".png" // default
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

// DeleteTemplate removes the template directory and all its contents.
func (s *LocalStorage) DeleteTemplate(id string) error {
	dir := s.templateDir(id)
	return os.RemoveAll(dir)
}

// Ping always succeeds for local storage (filesystem is always available).
func (s *LocalStorage) Ping() error {
	_, err := os.Stat(s.rootDir)
	if err != nil {
		return fmt.Errorf("storage root not accessible: %w", err)
	}
	return nil
}

// readFile is a helper that reads a named file from a template's directory.
func (s *LocalStorage) readFile(id, name string) ([]byte, error) {
	path := filepath.Join(s.templateDir(id), name)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("template %q not found", id)
		}
		return nil, fmt.Errorf("reading %s for %q: %w", name, id, err)
	}
	return data, nil
}
