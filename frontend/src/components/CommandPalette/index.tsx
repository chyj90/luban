import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import './CommandPalette.css';

export interface CommandItem {
  key: string;
  label: string;
  hint?: string;
  group: string;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
}

/** ⌘K / Ctrl+K 命令面板：应用内搜索页面、Query、API 并快速跳转模块 */
export function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const [keyword, setKeyword] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setKeyword('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(kw));
  }, [items, keyword]);

  useEffect(() => {
    setActiveIdx(0);
  }, [keyword]);

  useEffect(() => {
    if (!open) return;
    // capture + stopPropagation：Esc 只关面板，不再触发宿主的 Esc 逻辑（退出全屏/聚焦）
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        filtered[activeIdx]?.action();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, filtered, activeIdx, onClose]);

  useEffect(() => {
    listRef.current?.querySelector('.cp-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  let lastGroup = '';
  return (
    <div className="cp-backdrop" onMouseDown={onClose}>
      <div className="cp-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cp-input-row">
          <svg className="cp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="cp-input"
            value={keyword}
            placeholder="搜索页面、查询、API，或跳转模块…"
            onChange={(e) => setKeyword(e.target.value)}
          />
          <span className="cp-esc">Esc</span>
        </div>
        <div className="cp-list" ref={listRef}>
          {filtered.length === 0 && <div className="cp-empty">没有匹配的结果</div>}
          {filtered.map((it, idx) => {
            const groupHeader = it.group !== lastGroup
              ? <div className="cp-group">{it.group}</div>
              : null;
            lastGroup = it.group;
            return (
              <Fragment key={it.key}>
                {groupHeader}
                <div
                  className={`cp-item ${idx === activeIdx ? 'active' : ''}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => {
                    it.action();
                    onClose();
                  }}
                >
                  <span className="cp-item-label">{it.label}</span>
                  {it.hint && <span className="cp-item-hint">{it.hint}</span>}
                </div>
              </Fragment>
            );
          })}
        </div>
        <div className="cp-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>↵</kbd> 打开</span>
        </div>
      </div>
    </div>
  );
}
