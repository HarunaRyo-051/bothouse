package core

import (
	"os"
	"path/filepath"
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
		idleWatchSeed(t, e, key, script, TeamHandoff{Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Title: "no board", Board: 96})
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
		idleWatchSeed(t, e, key, true, TeamHandoff{Chat: key, At: at, Due: at.Add(time.Minute), Owner: e.name, Board: 98, Idle: watchIdleState{Ended: at, Wakes: wakes, Reported: reported}})
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

// #1167 (11-07): a lead's chat channel got 「接着做 #1162」 after every turn. #1162 was handed back
// by its workspace and fell back to the chat, and the lead's own board note looked like running
// work. Only an explicit 【接】 is watched in a chat channel; a workspace keeps its board watch.
func TestWatchChatBoardItemsWithoutAcceptAreNotWatched(t *testing.T) {
	e, p := idleWatchFixture(t)
	dir := t.TempDir()
	e.team = &teamState{dir: dir}
	line := `{"id":1162,"what":"搏仓第二版","status":"已交回待验收","who":"` + e.name + `","sk":"discord:chatA","chat":"discord:chatA","ws_was":"discord:ws2"}`
	line2 := `{"id":1167,"what":"桥 bug：主频道看门","status":"在做","who":"` + e.name + `","sk":"discord:chatA"}`
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(line+"\n"+line2+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, reply := range []string{"NO_REPLY", "看了一下，先这样", "接着做 #1162 的验收"} {
		e.watchTurnEnded(p, "discord:chatA:u1", reply, true, false, false, time.Time{})
		if got := idleWatchRows(t, e, "discord:chatA", true); len(got) != 0 {
			t.Fatalf("%q: board items alone must not watch the chat channel, got %+v", reply, got)
		}
	}
}

// A workspace still arms its board-owned watch without an explicit 【接】.
func TestWatchWorkspaceBoardItemWithoutAcceptIsWatched(t *testing.T) {
	e, p := idleWatchFixture(t)
	dir := t.TempDir()
	e.team = &teamState{dir: dir}
	teamWorkspaceStore.mu.Lock()
	err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), &teamWorkspaceState{Parents: map[string][]TeamWorkspace{
		"discord:chat1": {{Name: "工作区1", ID: "ws1"}},
	}, Version: teamWorkspaceStateVersion})
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	line := `{"id":9,"what":"接上游的接口","status":"进行中","who":"` + e.name + `","ws":"discord:ws1","chat":"discord:chat1"}`
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(line+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	e.watchTurnEnded(p, "discord:ws1:u1", "先读了交接，接下来改接口", true, false, false, time.Time{})
	got := idleWatchRows(t, e, "discord:ws1", true)
	if len(got) != 1 || got[0].Board != 9 {
		t.Fatalf("a workspace's active board item must stay watched, got %+v", got)
	}
}

// #1183 (11-07): a numberless watch from 09:13 woke a member at 19:03. A script watch whose board
// item or owner cannot be told is closed once its due time passed; one that names a board item is
// judged by the board instead.
func TestWatchStaleNumberlessWatchClosesAfterDue(t *testing.T) {
	due := time.Now().Add(-time.Minute)
	if !watchStale(TeamHandoff{Due: due, Owner: "橘", Title: "看不出是哪件"}, "discord:ws1", time.Now()) {
		t.Fatal("a numberless watch past due must be stale")
	}
	if watchStale(TeamHandoff{Due: due, Owner: "橘", Board: 12}, "discord:ws1", time.Now()) {
		t.Fatal("a watch with a board item is judged by the board")
	}
	if watchStale(TeamHandoff{Due: due, Owner: "橘", Title: "#12 集中发布"}, "discord:ws1", time.Now()) {
		t.Fatal("a title naming the item is not numberless")
	}
	if watchStale(TeamHandoff{Due: time.Now().Add(time.Hour), Owner: "橘"}, "discord:ws1", time.Now()) {
		t.Fatal("a watch that is not due yet is not stale")
	}
	if !watchStale(TeamHandoff{Due: due}, "discord:ws1", time.Now()) {
		t.Fatal("a watch with no owner cannot be woken: it is stale once due")
	}
}
