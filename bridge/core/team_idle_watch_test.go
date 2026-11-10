package core

import "testing"

func TestWatchBoardClosedAnchored(t *testing.T) {
	for _, tc := range []struct {
		status string
		closed bool
	}{
		{"在做：单测已完成，PR 待验收", false},
		{"交回待验收", false},
		{"等待用户拍板", false},
		{"donezo", false},
		{"已完成", true},
		{"  验收通过（返工 0）", true},
		{"DONE", true},
		{"done：收工", true},
	} {
		if got := watchBoardClosed(teamTaskBoardItem{Status: tc.status}); got != tc.closed {
			t.Errorf("status %q: closed=%v, want %v", tc.status, got, tc.closed)
		}
	}
}
