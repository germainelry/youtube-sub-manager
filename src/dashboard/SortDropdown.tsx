import { useCallback, useEffect, useRef, useState } from 'react';

interface SortOption {
  value: string;
  label: string;
  group: string;
}

interface SortDropdownProps {
  value: string;
  options: SortOption[];
  onChange: (value: string) => void;
}

export function SortDropdown({ value, options, onChange }: SortDropdownProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? '';

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const select = useCallback(
    (val: string) => {
      onChange(val);
      close();
      triggerRef.current?.focus();
    },
    [onChange, close],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(true);
          const idx = options.findIndex((o) => o.value === value);
          setActiveIndex(idx >= 0 ? idx : 0);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % options.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + options.length) % options.length);
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(options.length - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (activeIndex >= 0) select(options[activeIndex]!.value);
          break;
        case 'Escape':
          e.preventDefault();
          close();
          triggerRef.current?.focus();
          break;
        case 'Tab':
          close();
          break;
      }
    },
    [open, options, value, activeIndex, select, close],
  );

  const activeId = activeIndex >= 0 ? `sort-opt-${activeIndex}` : undefined;

  let lastGroup = '';

  return (
    <div className="sort-dropdown" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="sort-dropdown-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={activeId}
        onClick={() => {
          if (open) {
            close();
          } else {
            setOpen(true);
            const idx = options.findIndex((o) => o.value === value);
            setActiveIndex(idx >= 0 ? idx : 0);
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        {selectedLabel}
        <span className="sort-dropdown-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="sort-dropdown-panel" role="listbox" id="sort-listbox">
          {options.map((o, i) => {
            const showGroup = o.group !== lastGroup;
            lastGroup = o.group;
            const isSelected = o.value === value;
            const isFocused = i === activeIndex;
            return (
              <div key={o.value}>
                {showGroup && (
                  <div className="sort-dropdown-group" role="presentation">
                    {o.group}
                  </div>
                )}
                <button
                  type="button"
                  id={`sort-opt-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  className={`sort-dropdown-option${isSelected ? ' selected' : ''}${isFocused ? ' focused' : ''}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(o.value);
                  }}
                >
                  {o.label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
