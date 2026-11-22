import * as api from '../api/tauri';
import type { AppData, ExportDocFormat, NoteItem, TodoItem } from '../types/models';
import { formatDateKey, formatTimestampYMDHM } from './lunar';

export type ClientExportFormat = ExportDocFormat | 'csv';

export interface ExportBuilderOptions {
  scope?: string;
  noteId?: string | null;
  inlineImages?: Record<string, string>;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeCsvCell(text: string): string {
  const needsQuote = /[",\r\n]/.test(text);
  const safe = text.replace(/"/g, '""');
  return needsQuote ? `"${safe}"` : safe;
}

function activeTodos(data: AppData): TodoItem[] {
  return data.todos.filter((t) => !t.deletedAt);
}

function activeNotes(data: AppData, noteId?: string | null): NoteItem[] {
  const list = data.notes.filter((n) => !n.deletedAt);
  if (noteId) {
    return list.filter((n) => n.id === noteId);
  }
  return list;
}

export function buildMarkdownExport(data: AppData, options: ExportBuilderOptions = {}): string {
  const lines: string[] = [];
  const today = formatDateKey(new Date());
  lines.push(`# DeskTag 导出文档 (${today})`);
  lines.push('');

  const listNameMap = new Map(data.lists.filter((l) => !l.deletedAt).map((l) => [l.id, l.name]));

  if (!options.noteId && options.scope !== 'notes') {
    const todos = activeTodos(data);
    lines.push(`## 待办事项 (${todos.length})`);
    lines.push('');
    for (const todo of todos) {
      const box = todo.completed ? 'x' : ' ';
      const meta: string[] = [];
      if (todo.priority !== 'none') meta.push(`优先级:${todo.priority}`);
      if (todo.dueDate) meta.push(`截止:${todo.dueDate}${todo.dueTime ? ` ${todo.dueTime}` : ''}`);
      if (todo.listId && listNameMap.has(todo.listId)) meta.push(`清单:${listNameMap.get(todo.listId)}`);
      if (todo.tags.length > 0) meta.push(todo.tags.map((t) => `#${t}`).join(' '));
      lines.push(`- [${box}] **${todo.title}**${meta.length > 0 ? ` _(${meta.join(' · ')})_` : ''}`);
      if (todo.notes.trim()) {
        lines.push(`  > ${todo.notes.trim().replace(/\n/g, '\n  > ')}`);
      }
      for (const sub of todo.subtasks) {
        lines.push(`  - [${sub.completed ? 'x' : ' '}] ${sub.title}`);
        if (sub.notes.trim()) {
          lines.push(`    > ${sub.notes.trim().replace(/\n/g, '\n    > ')}`);
        }
      }
    }
    lines.push('');
  }

  if (options.scope !== 'todos') {
    const notes = activeNotes(data, options.noteId);
    if (notes.length > 0) {
      lines.push(`## 便签 (${notes.length})`);
      lines.push('');
      for (const note of notes) {
        lines.push(`### ${note.title || '未命名便签'}${note.kind === 'timeline' ? ' [时间轴]' : ''}`);
        lines.push('');
        if (note.kind === 'timeline') {
          for (const entry of note.timelineEntries) {
            lines.push(`- **${formatTimestampYMDHM(entry.createdAt)}** ${entry.content}`);
          }
        } else {
          lines.push(note.content || '');
        }
        if (note.attachments.length > 0) {
          lines.push('');
          lines.push(`附件: ${note.attachments.map((a) => `${a.name} (${Math.max(1, Math.round(a.size / 1024))} KB)`).join(', ')}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

export async function collectInlineImagesMap(data: AppData): Promise<Record<string, string>> {
  const paths = new Map<string, string>();
  for (const todo of activeTodos(data)) {
    for (const img of todo.noteImages) {
      paths.set(img.relativePath, img.mime);
    }
    for (const sub of todo.subtasks) {
      for (const img of sub.noteImages) {
        paths.set(img.relativePath, img.mime);
      }
    }
  }
  for (const note of activeNotes(data)) {
    for (const att of note.attachments) {
      if (att.kind === 'image') paths.set(att.relativePath, att.mime);
    }
    for (const entry of note.timelineEntries) {
      for (const att of entry.attachments) {
        if (att.kind === 'image') paths.set(att.relativePath, att.mime);
      }
    }
  }

  const resolved: Record<string, string> = {};
  await Promise.all(
    Array.from(paths.entries()).map(async ([relPath, mime]) => {
      try {
        const dataUrl = await api.readAttachmentDataUrl(relPath, mime);
        if (dataUrl) resolved[relPath] = dataUrl;
      } catch {
        // Skip unreadable images
      }
    }),
  );
  return resolved;
}

export function buildHtmlExport(data: AppData, options: ExportBuilderOptions = {}): string {
  const inlineImages = options.inlineImages ?? {};
  const listNameMap = new Map(data.lists.filter((l) => !l.deletedAt).map((l) => [l.id, l.name]));
  const today = formatDateKey(new Date());

  const renderImgTags = (imgs: Array<{ relativePath: string; name: string }>): string => {
    const html = imgs
      .map((img) => {
        const src = inlineImages[img.relativePath];
        if (!src) return '';
        return `<img src="${src}" alt="${escapeHtml(img.name)}" style="max-width:100%;max-height:280px;border-radius:8px;margin-top:6px;display:block;" />`;
      })
      .filter(Boolean)
      .join('');
    return html ? `<div class="imgs">${html}</div>` : '';
  };

  let todoSection = '';
  if (!options.noteId && options.scope !== 'notes') {
    const todos = activeTodos(data);
    const rows = todos
      .map((t) => {
        const badges: string[] = [];
        if (t.dueDate) badges.push(`${t.dueDate}${t.dueTime ? ` ${t.dueTime}` : ''}`);
        if (t.listId && listNameMap.has(t.listId)) badges.push(listNameMap.get(t.listId)!);
        for (const tag of t.tags) badges.push(`#${tag}`);
        const subHtml =
          t.subtasks.length > 0
            ? `<ul class="subtasks">${t.subtasks
                .map(
                  (s) =>
                    `<li class="${s.completed ? 'done' : ''}">${s.completed ? '✓' : '○'} ${escapeHtml(s.title)}${
                      s.notes ? `<div class="note-text">${escapeHtml(s.notes)}</div>` : ''
                    }${renderImgTags(s.noteImages)}</li>`,
                )
                .join('')}</ul>`
            : '';
        return `<div class="todo ${t.completed ? 'done' : ''}">
          <div class="todo-head">
            <span class="check">${t.completed ? '✓' : '○'}</span>
            <span class="title">${escapeHtml(t.title)}</span>
            <span class="meta">${badges.map((b) => `<span class="chip">${escapeHtml(b)}</span>`).join('')}</span>
          </div>
          ${t.notes ? `<div class="note-text">${escapeHtml(t.notes).replace(/\n/g, '<br/>')}</div>` : ''}
          ${renderImgTags(t.noteImages)}
          ${subHtml}
        </div>`;
      })
      .join('');
    todoSection = `<section><h2>待办事项 (${todos.length})</h2>${rows || '<p class="muted">暂无待办</p>'}</section>`;
  }

  let noteSection = '';
  if (options.scope !== 'todos') {
    const notes = activeNotes(data, options.noteId);
    const cards = notes
      .map((n) => {
        const body =
          n.kind === 'timeline'
            ? `<div class="timeline">${n.timelineEntries
                .map(
                  (e) =>
                    `<div class="tl-item"><div class="tl-time">${escapeHtml(formatTimestampYMDHM(e.createdAt))}</div><div>${escapeHtml(e.content).replace(/\n/g, '<br/>')}</div>${renderImgTags(
                      e.attachments.filter((a) => a.kind === 'image'),
                    )}</div>`,
                )
                .join('')}</div>`
            : `<div class="note-body">${escapeHtml(n.content).replace(/\n/g, '<br/>')}</div>${renderImgTags(
                n.attachments.filter((a) => a.kind === 'image'),
              )}`;
        return `<article class="note-card"><h3>${escapeHtml(n.title || '未命名便签')}</h3>${body}</article>`;
      })
      .join('');
    noteSection = `<section><h2>便签 (${notes.length})</h2>${cards || '<p class="muted">暂无便签</p>'}</section>`;
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>DeskTag 导出 - ${today}</title>
<style>
  body { font-family: 'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif; background:#fcfaf8; color:#2f2b27; max-width:820px; margin:28px auto; padding:0 20px; line-height:1.65; }
  h1 { font-size:22px; border-bottom:1px solid #e3e3d8; padding-bottom:10px; color:#2f2b27; }
  h2 { font-size:16px; margin-top:24px; color:#cf5a32; }
  h3 { font-size:15px; margin:0 0 8px; }
  .todo, .note-card { background:#fff; border:1px solid #e3e3d8; border-radius:10px; padding:12px 14px; margin-bottom:10px; }
  .todo.done .title, .subtasks li.done { color:#a09a92; }
  .todo-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .check { color:#e8734b; font-weight:700; }
  .title { font-weight:600; }
  .chip { background:#f6efe9; border:1px solid #e8d8cd; color:#7a5d4e; border-radius:999px; font-size:12px; padding:1px 8px; margin-left:4px; }
  .note-text, .note-body { font-size:13px; color:#5a544d; margin-top:6px; }
  .subtasks { margin:8px 0 0 18px; padding:0; list-style:none; font-size:13px; }
  .subtasks li { margin-bottom:4px; }
  .tl-item { border-left:2px solid #eab49f; padding-left:10px; margin-bottom:10px; }
  .tl-time { font-size:12px; color:#8d867e; }
  .muted { color:#999289; font-size:13px; }
  @media print { body { background:#fff; margin:0; max-width:none; } .todo, .note-card { break-inside:avoid; } }
</style>
</head>
<body>
  <h1>DeskTag 待办贴导出 · ${today}</h1>
  ${todoSection}
  ${noteSection}
</body>
</html>`;
}

export function buildCsvExport(data: AppData): string {
  const listNameMap = new Map(data.lists.filter((l) => !l.deletedAt).map((l) => [l.id, l.name]));
  const header = ['标题', '状态', '优先级', '截止日期', '时间', '所属清单', '标签', '子任务进度', '备注', '创建时间'];
  const rows = activeTodos(data).map((t) => {
    const doneSub = t.subtasks.filter((s) => s.completed).length;
    const progress = t.subtasks.length > 0 ? `${doneSub}/${t.subtasks.length}` : '';
    return [
      t.title,
      t.completed ? '已完成' : '未完成',
      t.priority,
      t.dueDate ?? '',
      t.dueTime ?? '',
      (t.listId && listNameMap.get(t.listId)) || '',
      t.tags.join('; '),
      progress,
      t.notes,
      t.createdAt,
    ]
      .map(escapeCsvCell)
      .join(',');
  });
  return `\uFEFF${header.map(escapeCsvCell).join(',')}\r\n${rows.join('\r\n')}\r\n`;
}

export function triggerBrowserDownload(filename: string, content: string | Blob, mime: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function openPrintablePdfView(
  data: AppData,
  options: ExportBuilderOptions = {},
): Promise<void> {
  const inlineImages = await collectInlineImagesMap(data);
  const html = buildHtmlExport(data, { ...options, inlineImages });
  const win = window.open('', '_blank', 'width=860,height=720');
  if (!win) {
    triggerBrowserDownload(`desktag-print-${formatDateKey(new Date())}.html`, html, 'text/html;charset=utf-8');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => {
    win.focus();
    win.print();
  }, 260);
}

export async function exportDeskTagDocument(
  data: AppData,
  format: ClientExportFormat,
  options: ExportBuilderOptions = {},
): Promise<{ ok: boolean; pathOrName: string; message: string }> {
  const today = formatDateKey(new Date());

  if (format === 'csv') {
    const csv = buildCsvExport(data);
    const filename = `desktag-todos-${today}.csv`;
    triggerBrowserDownload(filename, csv, 'text/csv;charset=utf-8');
    return { ok: true, pathOrName: filename, message: `已导出 CSV：${filename}` };
  }

  if (api.isTauriRuntime()) {
    const res = await api.exportDocument({
      format,
      scope: options.scope ?? 'all',
      noteId: options.noteId ?? null,
    });
    return { ok: true, pathOrName: res.path, message: `已导出到：${res.path}` };
  }

  if (format === 'pdf') {
    await openPrintablePdfView(data, options);
    return { ok: true, pathOrName: 'print-dialog', message: '已打开打印 / 保存为 PDF 视图' };
  }

  if (format === 'html') {
    const inlineImages = await collectInlineImagesMap(data);
    const html = buildHtmlExport(data, { ...options, inlineImages });
    const filename = `desktag-export-${today}.html`;
    triggerBrowserDownload(filename, html, 'text/html;charset=utf-8');
    return { ok: true, pathOrName: filename, message: `已导出 HTML：${filename}` };
  }

  if (format === 'markdown') {
    const md = buildMarkdownExport(data, options);
    const filename = `desktag-export-${today}.md`;
    triggerBrowserDownload(filename, md, 'text/markdown;charset=utf-8');
    return { ok: true, pathOrName: filename, message: `已导出 Markdown：${filename}` };
  }

  // Fallback Word-compatible HTML (.doc) when running in browser preview without Rust docx packager
  const inlineImages = await collectInlineImagesMap(data);
  const html = buildHtmlExport(data, { ...options, inlineImages });
  const filename = `desktag-export-${today}.doc`;
  triggerBrowserDownload(filename, html, 'application/msword;charset=utf-8');
  return { ok: true, pathOrName: filename, message: `已导出文档：${filename}` };
}
