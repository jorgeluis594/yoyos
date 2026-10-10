package images

import (
	"bytes"
	"encoding/binary"
)

// sniffMIME identifies the image formats v1 accepts from the file's own bytes. An empty result
// means the content is not a recognised image; the descriptor's MIME is never trusted.
func sniffMIME(head []byte) string {
	switch {
	case bytes.HasPrefix(head, []byte{0xFF, 0xD8, 0xFF}):
		return "image/jpeg"
	case bytes.HasPrefix(head, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case bytes.HasPrefix(head, []byte("GIF87a")), bytes.HasPrefix(head, []byte("GIF89a")):
		return "image/gif"
	case len(head) >= 12 && bytes.Equal(head[:4], []byte("RIFF")) && bytes.Equal(head[8:12], []byte("WEBP")):
		return "image/webp"
	case validBMP(head):
		return "image/bmp"
	case len(head) >= 12 && bytes.Equal(head[4:8], []byte("ftyp")):
		return sniffBrand(head[8:12])
	}
	return ""
}

func sniffBrand(brand []byte) string {
	switch string(brand) {
	case "heic", "heix", "hevc", "hevx":
		return "image/heic"
	case "mif1", "msf1", "heim", "heis":
		return "image/heif"
	case "avif", "avis":
		return "image/avif"
	}
	return ""
}

// validBMP checks the file header and a known DIB header size, not only the "BM" magic.
func validBMP(head []byte) bool {
	if len(head) < 18 || !bytes.HasPrefix(head, []byte("BM")) || head[6] != 0 || head[7] != 0 || head[8] != 0 || head[9] != 0 {
		return false
	}
	switch binary.LittleEndian.Uint32(head[14:18]) {
	case 12, 40, 52, 56, 64, 108, 124:
		return true
	}
	return false
}
