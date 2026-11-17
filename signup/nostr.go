package main

import (
	"encoding/hex"
	"strings"
)

const bech32Charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

func bech32Polymod(values []byte) uint32 {
	gen := [5]uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	chk := uint32(1)
	for _, v := range values {
		top := chk >> 25
		chk = (chk&0x1ffffff)<<5 ^ uint32(v)
		for i, g := range gen {
			if (top>>i)&1 == 1 {
				chk ^= g
			}
		}
	}
	return chk
}

func hrpExpand(hrp string) []byte {
	out := make([]byte, 0, len(hrp)*2+1)
	for _, c := range hrp {
		out = append(out, byte(c)>>5)
	}
	out = append(out, 0)
	for _, c := range hrp {
		out = append(out, byte(c)&31)
	}
	return out
}

func bech32Decode(s, hrp string) ([]byte, bool) {
	if !strings.HasPrefix(s, hrp+"1") || len(s) > 200 {
		return nil, false
	}
	data := s[len(hrp)+1:]
	if len(data) < 7 {
		return nil, false
	}
	words := make([]byte, len(data))
	for i := range data {
		idx := strings.IndexByte(bech32Charset, data[i])
		if idx < 0 {
			return nil, false
		}
		words[i] = byte(idx)
	}
	if bech32Polymod(append(hrpExpand(hrp), words...)) != 1 {
		return nil, false
	}
	var acc, bits uint32
	var out []byte
	for _, w := range words[:len(words)-6] {
		acc = acc<<5 | uint32(w)
		bits += 5
		for bits >= 8 {
			bits -= 8
			out = append(out, byte(acc>>bits))
		}
	}
	return out, true
}

func encodeNpub(hexKey string) string {
	b, _ := hex.DecodeString(hexKey)
	var words []byte
	var acc, bits uint32
	for _, x := range b {
		acc = acc<<8 | uint32(x)
		bits += 8
		for bits >= 5 {
			bits -= 5
			words = append(words, byte(acc>>bits)&31)
		}
	}
	if bits > 0 {
		words = append(words, byte(acc<<(5-bits))&31)
	}
	poly := bech32Polymod(append(append(hrpExpand("npub"), words...), 0, 0, 0, 0, 0, 0)) ^ 1
	for i := 0; i < 6; i++ {
		words = append(words, byte(poly>>(5*(5-i)))&31)
	}
	var sb strings.Builder
	sb.WriteString("npub1")
	for _, w := range words {
		sb.WriteByte(bech32Charset[w])
	}
	return sb.String()
}
