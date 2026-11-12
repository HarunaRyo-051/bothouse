package core

import (
	"testing"
	"time"
)

func idleWatchFixture(t *testing.T) (*Engine, *exitTestPlatform) {
	t.Helper()
	e, _, p := exitFixture(t, nil)
	dir := e.dataDir
	t.Cleanup(func() {
		teamWorkspaceStore.mu.Lock()
		delete(teamWorkspaceStore.cache, teamWorkspacePath(dir))
		teamWorkspaceStore.mu.Unlock()
	})
	return e, p
}

func idleWatchSeed(t *testing.T, e *Engine, key string, script bool, h TeamHandoff) {
	t.Helper()
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	path := teamWorkspacePath(e.dataDir)
	st := loadTeamWorkspacesLocked(path)
	if script {
		st.ScriptWatches = map[string][]TeamHandoff{key: {h}}
	} else {
		st.Handoffs = map[string][]TeamHandoff{key: {h}}
	}
	if err := saveTeamWorkspacesLocked(path, st); err != nil {
		t.Fatal(err)
	}
}

func idleWatchRows(t *testing.T, e *Engine, key string, script bool) []TeamHandoff {
	t.Helper()
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	if script {
		return append([]TeamHandoff(nil), st.ScriptWatches[key]...)
	}
	return append([]TeamHandoff(nil), st.Handoffs[key]...)
}

func TestWatchBoardlessReportEndsWatch(t *testing.T) {
	for _, script := range []bool{false, true} {
		e, p := idleWatchFixture(t)
		key := "discord:ws96"
		at := time.Now().Add(-2 * time.Minute)
		idleWatchSeed(t, e, key, script, TeamHandoff{Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Title: "no board"})
		e.watchTurnEnded(p, key+":u1", "[report] 背景：无任务号的交回\n要你做的：没有", false, false, false, time.Time{})
		rows := idleWatchRows(t, e, key, script)
		if len(rows) != 1 || !rows[0].Idle.Returned {
			t.Fatalf("script=%v: boardless report did not end watch: %+v", script, rows)
		}
	}
}

func TestWatchNumberedReportKeepsHeadlineRepair(t *testing.T) {
	e, p := idleWatchFixture(t)
	key := "discord:ws97"
	at := time.Now().Add(-2 * time.Minute)
	idleWatchSeed(t, e, key, true, TeamHandoff{Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Title: "board report"})
	e.watchTurnEnded(p, key+":u1", "[report] #77 背景：还缺验收字段", false, false, false, time.Time{})
	if rows := idleWatchRows(t, e, key, true); len(rows) != 1 || rows[0].Idle.Returned {
		t.Fatalf("numbered report must remain repairable: %+v", rows)
	}
}

func TestWatchProgressDoesNotReviveReportedWatch(t *testing.T) {
	for _, reported := range []bool{false, true} {
		e, p := idleWatchFixture(t)
		key := "discord:ws98"
		at := time.Now().Add(-2 * time.Minute)
		wakes := 1
		if reported {
			wakes = 2
		}
		idleWatchSeed(t, e, key, true, TeamHandoff{Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Idle: watchIdleState{Ended: at, Wakes: wakes, Reported: reported}})
		e.watchTurnEnded(p, key+":u1", "继续做", true, false, false, time.Time{})
		rows := idleWatchRows(t, e, key, true)
		if len(rows) != 1 || rows[0].Idle.Reported != reported || (reported && rows[0].Idle.Wakes != 2) || (!reported && rows[0].Idle.Wakes != 0) {
			t.Fatalf("reported=%v: progress changed watch incorrectly: %+v", reported, rows)
		}
	}
}

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
