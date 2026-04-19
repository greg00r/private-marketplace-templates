// Package storage defines the Storage interface and provides local and external implementations.
package storage

import (
	"errors"
	"io"
)

var (
	// ErrTemplateNotFound is returned when a template does not exist in storage.
	ErrTemplateNotFound = errors.New("template not found")
	// ErrTemplateAlreadyExists is returned when a template ID is already present in storage.
	ErrTemplateAlreadyExists = errors.New("template already exists")
)

type TemplateState string

const (
	TemplateStateApproved TemplateState = "approved"
	TemplateStatePending  TemplateState = "pending"
)

func NormalizeTemplateState(state TemplateState) TemplateState {
	switch state {
	case TemplateStatePending:
		return TemplateStatePending
	default:
		return TemplateStateApproved
	}
}

// TemplateFile represents a single named file in a template.
type TemplateFile struct {
	Name    string
	Content []byte
}

// Storage is the interface that both local and external backends implement.
// All paths are relative to a template ID.
type Storage interface {
	// ListTemplates returns raw metadata JSON bytes for every template in the store.
	ListTemplates(state TemplateState) ([][]byte, error)

	// GetMetadata returns the metadata.json content for the given template ID.
	GetMetadata(id string, state TemplateState) ([]byte, error)

	// GetTemplate returns the template.json (dashboard model) for the given ID.
	GetTemplate(id string, state TemplateState) ([]byte, error)

	// GetVariables returns the variables.json for the given template ID.
	GetVariables(id string, state TemplateState) ([]byte, error)

	// GetImage returns the image bytes and MIME type for the given template ID.
	GetImage(id string, state TemplateState) ([]byte, string, error)

	// TemplateExists reports whether a template with the given ID already exists.
	TemplateExists(id string) (bool, error)

	// SaveTemplate stores all four files for a new template.
	// metadataJSON and variablesJSON must be valid JSON.
	// image may be nil (no image).
	SaveTemplate(id string, state TemplateState, templateJSON, metadataJSON, variablesJSON []byte, image io.Reader, imageMime string) error

	// ApproveTemplate moves a template from the pending queue into the approved queue.
	ApproveTemplate(id string, metadataJSON []byte) error

	// DeleteTemplate removes a template and all its files.
	DeleteTemplate(id string, state TemplateState) error

	// Ping checks connectivity (mainly for external backends).
	Ping() error
}
