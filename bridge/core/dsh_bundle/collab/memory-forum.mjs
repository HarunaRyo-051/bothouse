// 记忆论坛（轻量版）：每条记忆是一页 markdown，放在成员的 wiki 目录下。
// 每轮挑几条相关记忆附进成员指令，回复里写了 [#编号] 就算用过；不跑 gate，也不做向量检索。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** How many entries one turn may carry; more than this is noise, not memory. */
export const MEMORY_LIMIT = 3;
const MAX_NAME = 60;
const MAX_DESC = 160;

/** Frontmatter of one memory page: only the two keys a badge needs. */
export function parseMemoryPage(text) {
  const meta = {};
  const raw = String(text ?? '');
  if (!raw.startsWith('---\n')) return { meta, body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end < 0) return { meta, body: raw };
  for (const line of raw.slice(4, end).split('\n')) {
    const m = /^(name|description):\s*(.*)$/.exec(line);
    if (m) meta[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const after = raw.indexOf('\n', end + 1);
  return { meta, body: after < 0 ? '' : raw.slice(after + 1) };
}

/**
 * Terms a memory page and a message can share: latin words, plus CJK bigrams (a Chinese sentence has
 * no spaces, so a word split would never match anything).
 */
const terms = text => {
  const value = String(text ?? '').toLowerCase();
  const out = new Set(value.split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(w => w.length >= 2 && /[a-z0-9]/.test(w)));
  for (const run of value.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
  }
  return out;
};

export class MemoryForum {
  /** @param options - { dataDir: the collab data dir (~/.conest-collab); home fallback }. */
  constructor({ dataDir = process.env.CONEST_DATA_DIR, logger } = {}) {
    this.dataDir = String(dataDir ?? '').trim();
    this.logger = logger;
    /** `${member}\0${room}` -> entries handed to this turn, so a reply can say which it used. */
    this.turnEntries = new Map();
  }

  /** The directory holding one member's memory pages. */
  dir(member) {
    return this.dataDir ? join(this.dataDir, 'roles', String(member), 'wiki', 'memory') : '';
  }

  /** Every memory page of a member: { id, name, description }. Ids are the file stems. */
  entries(member) {
    const dir = this.dir(member);
    if (!dir || !existsSync(dir)) return [];
    const out = [];
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.md') || name.startsWith('.')) continue;
      try {
        const { meta } = parseMemoryPage(readFileSync(join(dir, name), 'utf8'));
        out.push({ id: name.replace(/\.md$/, ''), name: meta.name ?? name.replace(/\.md$/, ''), description: meta.description ?? '' });
      } catch { /* an unreadable page is not a reason to fail a turn */ }
    }
    return out;
  }

  /**
   * The entries worth putting in front of a member this turn: keyword overlap with the message that
   * called it, newest first on a tie. No overlap means nothing is pushed — memory is not decoration.
   */
  select(member, text, limit = MEMORY_LIMIT) {
    const said = terms(text);
    if (said.size === 0) return [];
    const scored = [];
    for (const entry of this.entries(member)) {
      const own = terms(`${entry.name} ${entry.description}`);
      let score = 0;
      for (const term of own) if (said.has(term)) score += 1;
      // One shared bigram picked "不要删除生产数据库" for 「不要吃辣」: require two, or the page's own
      // name appearing in the message.
      if (score >= 2 || (entry.name.length >= 2 && String(text ?? '').includes(entry.name))) scored.push({ entry, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(row => row.entry);
  }

  /** The block a turn carries; empty when nothing matched, so the prompt stays clean. */
  block(entries) {
    if (entries.length === 0) return '';
    const lines = entries.map(entry => `- [#${entry.id}] ${entry.name}${entry.description ? ` — ${entry.description}` : ''}`);
    return `（可能相关的记忆，用得上就在回复里带上 [#编号]）\n${lines.join('\n')}`;
  }

  /** Remember what this turn was handed, so the reply can be checked against it. */
  remember(member, room, entries) {
    if (entries.length > 0) this.turnEntries.set(`${member}\0${room}`, entries);
    else this.turnEntries.delete(`${member}\0${room}`);
  }

  /** The entries a reply actually cited, by `[#id]`; clears the turn's list. */
  cited(member, room, reply) {
    const key = `${member}\0${room}`;
    const entries = this.turnEntries.get(key) ?? [];
    this.turnEntries.delete(key);
    const text = String(reply ?? '');
    return entries.filter(entry => text.includes(`[#${entry.id}]`));
  }

  /** Write one memory page for a member; a repeated name overwrites that page instead of piling up. */
  write(member, { name, description }) {
    const dir = this.dir(member);
    if (!dir) return undefined;
    const clean = String(name ?? '').trim().slice(0, MAX_NAME);
    if (!clean) return undefined;
    mkdirSync(dir, { recursive: true });
    const id = clean.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'memory';
    const detail = String(description ?? '').trim();
    const summary = detail.slice(0, MAX_DESC);
    // The page keeps the whole thing: a lesson cut at 40 characters lost its conclusion.
    const body = `---\nname: ${clean}\ndescription: ${summary}\n---\n\n${clean}\n${detail ? `\n${detail}\n` : ''}`;
    writeFileSync(join(dir, `${id}.md`), body);
    return { id, name: clean, description: summary };
  }
}
