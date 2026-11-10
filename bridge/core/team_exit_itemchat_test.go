package core

import "testing"

func TestItemChatParentUsesTaskChannel(t *testing.T) {
	e := &Engine{}
	item := &teamTaskBoardItem{ID: 42, Chat: "discord:original"}
	for _, tc := range []struct {
		platform string
		chat     string
		want     string
	}{
		{"discord", "discord:original", "original"},
		{"discord", "feishu:other", "current"},
		{"discord", "discord:workspace", "current"},
	} {
		item.Chat = tc.chat
		if got := e.itemChatParent(tc.platform, "workspace", "current", 42, item); got != tc.want {
			t.Errorf("chat %q: parent=%q, want %q", tc.chat, got, tc.want)
		}
	}
	if got := e.itemChatParent("discord", "workspace", "current", 43, item); got != "current" {
		t.Errorf("different board item: parent=%q", got)
	}
}
