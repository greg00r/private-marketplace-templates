// Package storage defines the Storage interface and provides local and external implementations.
package storage

import "io"

// TemplateFile represents a single named file in a template.
type TemplateFile struct {
	Name    string
	Content []byte
}

// Storage is the interface that both local and external backends implement.
// All paths are relative to a template ID.
type Storage interface {
	// ListTemplates returns raw metadata JSON bytes for every template in the store.
	ListTemplates() ([][]byte, error)

	// GetMetadata returns the metadata.json content for the given template ID.
	GetMetadata(id string) ([]byte, error)

	// GetTemplate returns the template.json (dashboard model) for the given ID.
	GetTemplate(id string) ([]byte, error)

	// GetVariables returns the variables.json for the given template ID.
	GetVariables(id string) ([]byte, error)

	// GetImage returns the image bytes and MIME type for the given template ID.
	GetImage(id string) ([]byte, string, error)

	// SaveTemplate stores all four files for a new template.
	// metadataJSON and variablesJSON must be valid JSON.
	// image may be nil (no image).
	SaveTemplate(id string, templateJSON, metadataJSON, variablesJSON []byte, image io.Reader, imageMime string) error

	// DeleteTemplate removes a template and all its files.
	DeleteTemplate(id string) error

	// Ping checks connectivity (mainly for external backends).
	Ping() error
}
