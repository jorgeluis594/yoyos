package images

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"

	"yoyos-whatsapp/internal/normalization"
)

// Descriptor is a validated wa-image:v1 descriptor.
type Descriptor struct {
	AccountID     string
	MessageID     string
	MIMEType      string
	DirectPath    string
	MediaKey      []byte
	FileSHA256    []byte
	FileEncSHA256 []byte
	FileLength    uint64
	HasLength     bool
}

type descriptorJSON struct {
	AccountID     string `json:"accountId"`
	MessageID     string `json:"messageId"`
	MIMEType      string `json:"mimeType"`
	DirectPath    string `json:"directPath"`
	MediaKey      string `json:"mediaKey"`
	FileSHA256    string `json:"fileSha256"`
	FileEncSHA256 string `json:"fileEncSha256"`
	FileLength    string `json:"fileLength"`
}

// ParseDescriptor accepts only descriptors the normalization contract accepts; anything else is
// INVALID_INPUT. An incomplete but well-formed descriptor parses; Complete reports it.
func ParseDescriptor(messageID, downloadReference string) (Descriptor, *Error) {
	reference := normalization.ImageReference{MessageID: messageID, DownloadReference: downloadReference}
	if normalization.ValidateImageReference(reference) != nil {
		return Descriptor{}, fail(InvalidInput, nil)
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(downloadReference, "wa-image:v1:"))
	if err != nil {
		return Descriptor{}, fail(InvalidInput, nil)
	}
	var fields descriptorJSON
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&fields) != nil {
		return Descriptor{}, fail(InvalidInput, nil)
	}
	out := Descriptor{AccountID: fields.AccountID, MessageID: fields.MessageID, MIMEType: fields.MIMEType, DirectPath: fields.DirectPath}
	for _, item := range []struct {
		text string
		into *[]byte
	}{{fields.MediaKey, &out.MediaKey}, {fields.FileSHA256, &out.FileSHA256}, {fields.FileEncSHA256, &out.FileEncSHA256}} {
		if item.text == "" {
			continue
		}
		value, err := base64.StdEncoding.DecodeString(item.text)
		if err != nil {
			return Descriptor{}, fail(InvalidInput, nil)
		}
		*item.into = value
	}
	if fields.FileLength != "" {
		n, err := strconv.ParseUint(fields.FileLength, 10, 64)
		if err != nil {
			return Descriptor{}, fail(InvalidInput, nil)
		}
		out.FileLength, out.HasLength = n, true
	}
	return out, nil
}

// Complete reports whether the descriptor carries everything needed to download and verify.
func (d Descriptor) Complete() bool {
	return d.DirectPath != "" && len(d.MediaKey) == 32 && len(d.FileSHA256) == 32 && len(d.FileEncSHA256) == 32
}
